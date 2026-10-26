import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './lib/config.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { MIGRATIONS, formatState, planMigration } from './lib/local/migrations.mjs'
import { runMigrate } from './pmkit.mjs'
import { validateRepo } from './lib/validate.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { fixedNow, hashTree, makeRepo, scriptedRandom } from './test-helpers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, 'pmkit.mjs')

// A test-only migration: format 2 calls the log_time event op "time".
const renameLogTime = {
  from: 1,
  to: 2,
  describe: 'log_time events become time events',
  run(dir) {
    const issues = path.join(dir, 'issues')
    for (const id of fs.readdirSync(issues)) {
      const file = path.join(issues, id, 'events.jsonl')
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      const next = text.split('\n').map((line) => {
        if (line.trim() === '') return line
        const event = JSON.parse(line)
        return event.op === 'log_time' ? JSON.stringify({ ...event, op: 'time' }) : line
      }).join('\n')
      if (next !== text) fs.writeFileSync(file, next)
    }
  },
}

// A basic repo on tracker format 1, with a comment in its tracker config and three issues, two of them with logged time.
function setup() {
  const root = makeRepo('basic')
  const configFile = path.join(root, '.issues', 'config.yaml')
  const tracker = createLocalTracker(root, { now: fixedNow(), random: scriptedRandom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) })
  const [a, b, c] = ['A', 'B', 'C'].map((title) => tracker.createIssue({ title }, 'fred').after.id)
  tracker.logTime(a, 30, 'fred')
  tracker.logTime(b, 15, 'fred')
  fs.writeFileSync(configFile, `# tracker settings\n${fs.readFileSync(configFile, 'utf8').replace(/^version: \d+$/m, 'version: 1')}`)
  return { root, a, b, c }
}

test('formatState compares a version with the current format', () => {
  assert.equal(formatState(2), 'current')
  assert.equal(formatState(1, 2), 'behind')
  assert.equal(formatState(3, 2), 'ahead')
  for (const version of ['1', undefined, null, 1.5]) {
    assert.throws(() => formatState(version), (error) => error.code === 'INVALID_INPUT', String(version))
  }
})

test('planMigration runs each step on a copy and lists the files it changed', () => {
  const { root, a, b } = setup()
  const before = hashTree(root)
  const plan = planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [renameLogTime] })
  assert.equal(plan.from, 1)
  assert.equal(plan.to, 2)
  assert.deepEqual(plan.steps, [{
    from: 1,
    to: 2,
    describe: 'log_time events become time events',
    changes: [
      { path: '.issues/config.yaml', action: 'change' },
      { path: `.issues/issues/${a}/events.jsonl`, action: 'change' },
      { path: `.issues/issues/${b}/events.jsonl`, action: 'change' },
    ].sort((x, y) => (x.path < y.path ? -1 : 1)),
  }])
  const copied = fs.readFileSync(path.join(plan.dir, 'config.yaml'), 'utf8')
  assert.equal(parseYaml(copied).version, 2)
  assert.match(copied, /^# tracker settings$/m)
  assert.match(fs.readFileSync(path.join(plan.dir, 'issues', a, 'events.jsonl'), 'utf8'), /"op":"time"/)
  assert.equal(hashTree(root), before)
})

test('planMigration lists create and delete actions', () => {
  const { root } = setup()
  const reshape = {
    from: 1,
    to: 2,
    describe: 'docs move to notes',
    run(dir) {
      fs.rmSync(path.join(dir, 'docs', '.gitkeep'))
      fs.mkdirSync(path.join(dir, 'notes'))
      fs.writeFileSync(path.join(dir, 'notes', '.gitkeep'), '')
    },
  }
  const { steps } = planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [reshape] })
  assert.deepEqual(steps[0].changes, [
    { path: '.issues/config.yaml', action: 'change' },
    { path: '.issues/docs/.gitkeep', action: 'delete' },
    { path: '.issues/notes/.gitkeep', action: 'create' },
  ])
})

test('a gap in the migration chain throws NOT_SUPPORTED', () => {
  const { root } = setup()
  assert.throws(
    () => planMigration({ root, trackerPath: '.issues', from: 1, to: 3, migrations: [renameLogTime] }),
    (error) => error.code === 'NOT_SUPPORTED',
  )
})

test('loadConfig reads an older format through a migrated copy and the tracker refuses writes', () => {
  const { root, a } = setup()
  const before = hashTree(root)
  const config = loadConfig(root, { formatVersion: 2, migrations: [renameLogTime] })
  assert.deepEqual(config.format, { state: 'behind', version: 1, current: 2 })
  assert.equal(config.issuesDir, path.join(root, '.issues'))
  assert.notEqual(config.readDir, config.issuesDir)
  const tracker = createLocalTracker(root, { config, now: fixedNow(), random: scriptedRandom([20, 21, 22, 23]) })
  const ops = tracker.getHistory(a).map((event) => event.op)
  assert.ok(ops.includes('time'))
  assert.ok(!ops.includes('log_time'))
  assert.throws(
    () => tracker.createIssue({ title: 'X' }, 'fred'),
    (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:upgrade'
      && error.message === 'this repository uses tracker format 1, this pmkit writes format 2',
  )
  assert.equal(hashTree(root), before)
})

test('validateRepo reports an older format as one FORMAT problem', () => {
  const { root } = setup()
  const config = loadConfig(root, { formatVersion: 2, migrations: [renameLogTime] })
  assert.deepEqual(validateRepo(root, { config }).problems, [
    { path: '.issues/config.yaml', code: 'FORMAT', message: 'this repository uses tracker format 1, this pmkit writes format 2; run /pmkit:upgrade' },
  ])
})

test('loadConfig refuses a newer format and returns the current one as it is', () => {
  const { root } = setup()
  assert.throws(
    () => loadConfig(root, { formatVersion: 0 }),
    (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:upgrade'
      && error.message === 'this repository uses tracker format 1, this pmkit reads up to format 0',
  )
  const config = loadConfig(makeRepo('basic'))
  assert.deepEqual(config.format, { state: 'current', version: 2, current: 2 })
  assert.equal(config.readDir, undefined)
})

test('loadConfig reports a missing version as INVALID_INPUT', () => {
  const root = makeRepo('basic')
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(/^version: 2\n/m, ''))
  assert.throws(() => loadConfig(root), (error) => error.code === 'INVALID_INPUT' && /version/.test(error.message))
})

test('loadConfig reports a version below 1 as INVALID_INPUT', () => {
  const root = makeRepo('basic')
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(/^version: 2$/m, 'version: 0'))
  assert.throws(
    () => loadConfig(root),
    (error) => error.code === 'INVALID_INPUT' && error.message === '.issues/config.yaml: the tracker format version must be 1 or more, found 0',
  )
})

test('the migrated copy is removed when the process exits', () => {
  const { root } = setup()
  const script = `
    const { migratedCopy } = await import(${JSON.stringify(new URL('./lib/local/migrations.mjs', import.meta.url).href)})
    const migration = { from: 1, to: 2, describe: 'noop', run() {} }
    process.stdout.write(migratedCopy({ root: ${JSON.stringify(root)}, trackerPath: '.issues', from: 1, to: 2, migrations: [migration] }))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.length > 0)
  assert.equal(fs.existsSync(result.stdout), false)
})

function cli(cwd, args) {
  const env = { ...process.env, PMKIT_USER: 'fred', PMKIT_NOW: '2026-10-23T12:00:00Z', PMKIT_SEED: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' }
  const result = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, env, encoding: 'utf8' })
  return { status: result.status, body: JSON.parse(result.stdout) }
}

test('the CLI refuses reads and writes on a newer format and writes nothing', () => {
  const root = makeRepo('basic')
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(/^version: 2$/m, 'version: 3'))
  const before = hashTree(root)
  for (const args of [['issues', 'list'], ['issues', 'create', '--title', 'X']]) {
    const { status, body } = cli(root, args)
    assert.equal(status, 2, args.join(' '))
    assert.equal(body.error.code, 'NOT_SUPPORTED')
    assert.equal(body.error.nextStep, '/pmkit:upgrade')
    assert.equal(body.error.message, 'this repository uses tracker format 3, this pmkit reads up to format 2')
  }
  assert.equal(hashTree(root), before)
  const { status, body } = cli(root, ['validate'])
  assert.equal(status, 0)
  assert.deepEqual(body.problems, [
    { path: '.issues/config.yaml', code: 'FORMAT', message: 'this repository uses tracker format 3, this pmkit reads up to format 2; run /pmkit:upgrade' },
  ])
})

test('validate lists a version below 1 as one problem and exits 0', () => {
  const root = makeRepo('basic')
  const configFile = path.join(root, '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(/^version: 2$/m, 'version: 0'))
  const { status, body } = cli(root, ['validate'])
  assert.equal(status, 0)
  assert.deepEqual(body.problems, [
    { path: '.issues/config.yaml', code: 'config', message: '.issues/config.yaml: the tracker format version must be 1 or more, found 0' },
  ])
})

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })
const subjects = (root) => git(root, 'log', '--format=%s').stdout

test('planMigration turns a throwing step into INVALID_INPUT', () => {
  const { root } = setup()
  const broken = { from: 1, to: 2, describe: 'broken', run() { throw new Error('bad event') } }
  assert.throws(
    () => planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [broken] }),
    (error) => error.code === 'INVALID_INPUT' && error.message === 'migration 1 to 2 failed: bad event' && error.nextStep === 'pmkit validate',
  )
})

// A committed repo; `tracker.path` can be moved to another folder.
function gitRepo({ autoCommit = false, trackerPath } = {}) {
  const made = setup()
  const { root } = made
  if (trackerPath) {
    fs.renameSync(path.join(root, '.issues'), path.join(root, trackerPath))
    const file = path.join(root, '.pmkit', 'config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^  path: .*$/m, `  path: ${trackerPath}`))
  }
  const configFile = path.join(root, trackerPath ?? '.issues', 'config.yaml')
  fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(/^auto_commit: .*$/m, `auto_commit: ${autoCommit}`))
  assert.equal(git(root, 'init', '-q').status, 0)
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@x.dev')
  assert.equal(git(root, 'add', '-A').status, 0)
  assert.equal(git(root, 'commit', '-qm', 'initial').status, 0)
  return { ...made, dir: path.join(root, trackerPath ?? '.issues') }
}
const options = { formatVersion: 2, migrations: [renameLogTime] }

test('migrate --dry-run returns the plan and writes nothing', () => {
  const { root, a, b, dir } = gitRepo()
  const before = hashTree(dir)
  const result = runMigrate(root, { dryRun: true, ...options })
  assert.deepEqual(result.data, {
    from: 1,
    to: 2,
    steps: [{
      from: 1,
      to: 2,
      changes: [
        { path: '.issues/config.yaml', action: 'change' },
        { path: `.issues/issues/${a}/events.jsonl`, action: 'change' },
        { path: `.issues/issues/${b}/events.jsonl`, action: 'change' },
      ].sort((x, y) => (x.path < y.path ? -1 : 1)),
    }],
  })
  assert.match(result.text, /would migrate tracker format 1 to 2/)
  assert.equal(hashTree(dir), before)
})

test('migrate writes what the dry run listed', () => {
  const { root, dir } = gitRepo()
  const plan = planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [renameLogTime] })
  const result = runMigrate(root, options)
  assert.equal(result.data.commit, undefined)
  assert.equal(hashTree(dir), hashTree(plan.dir))
  assert.equal(parseYaml(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).version, 2)
  assert.equal(subjects(root), 'initial\n')
})

test('migrate applies create and delete changes', () => {
  const { root, dir } = gitRepo()
  const reshape = {
    from: 1,
    to: 2,
    describe: 'docs move to notes',
    run(copy) {
      fs.rmSync(path.join(copy, 'docs', '.gitkeep'))
      fs.mkdirSync(path.join(copy, 'notes'))
      fs.writeFileSync(path.join(copy, 'notes', '.gitkeep'), '')
    },
  }
  runMigrate(root, { formatVersion: 2, migrations: [reshape] })
  assert.equal(fs.existsSync(path.join(dir, 'docs', '.gitkeep')), false)
  assert.equal(fs.existsSync(path.join(dir, 'notes', '.gitkeep')), true)
})

test('migrate refuses uncommitted changes under tracker.path with CONFLICT and writes nothing', () => {
  const { root, dir } = gitRepo({ trackerPath: 'tracker' })
  fs.writeFileSync(path.join(dir, 'docs', 'note.md'), 'draft')
  const before = hashTree(dir)
  for (const dryRun of [true, false]) {
    assert.throws(
      () => runMigrate(root, { dryRun, ...options }),
      (error) => error.code === 'CONFLICT' && error.nextStep === 'Commit or discard the changes under tracker first',
    )
  }
  assert.equal(hashTree(dir), before)
})

test('a change outside tracker.path does not block migrate', () => {
  const { root, dir } = gitRepo({ trackerPath: 'tracker' })
  fs.writeFileSync(path.join(root, 'README.md'), 'x')
  runMigrate(root, options)
  assert.equal(parseYaml(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')).version, 2)
})

test('migrate outside a git repository throws NOT_CONFIGURED', () => {
  const { root } = setup()
  const dir = path.join(root, '.issues')
  const before = hashTree(dir)
  assert.throws(
    () => runMigrate(root, options),
    (error) => error.code === 'NOT_CONFIGURED' && error.nextStep === 'migrate needs a git repository: git history is the only way back from a migration',
  )
  assert.equal(hashTree(dir), before)
})

test('migrate with auto_commit commits once with its own message', () => {
  const { root } = gitRepo({ autoCommit: true })
  const result = runMigrate(root, options)
  assert.equal(result.data.commit, 'pmkit: migrate tracker format 1 to 2')
  assert.equal(subjects(root), 'pmkit: migrate tracker format 1 to 2\ninitial\n')
  assert.equal(git(root, 'status', '--porcelain').stdout, '')
})

test('migrate --dry-run with auto_commit true does not commit', () => {
  const { root, dir } = gitRepo({ autoCommit: true })
  try {
    const before = hashTree(dir)
    const result = runMigrate(root, { dryRun: true, ...options })
    assert.equal(result.data.commit, undefined)
    assert.equal(subjects(root), 'initial\n')
    assert.equal(hashTree(dir), before)
    assert.equal(git(root, 'status', '--porcelain').stdout, '')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('migrate with auto_commit keeps a staged outside file staged and out of the commit', () => {
  const { root } = gitRepo({ autoCommit: true })
  try {
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside\n')
    assert.equal(git(root, 'add', 'outside.txt').status, 0)
    runMigrate(root, options)
    assert.equal(subjects(root), 'pmkit: migrate tracker format 1 to 2\ninitial\n')
    assert.equal(git(root, 'status', '--porcelain').stdout, 'A  outside.txt\n')
    const files = git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.trim().split('\n')
    assert.ok(files.length > 0 && files.every((file) => file.startsWith('.issues/')), files.join(', '))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('migrate on a newer format throws NOT_SUPPORTED', () => {
  const { root } = gitRepo()
  assert.throws(() => runMigrate(root, { formatVersion: 0, migrations: [] }), (error) => error.code === 'NOT_SUPPORTED' && error.nextStep === '/pmkit:upgrade')
})

test('CLI migrate --json on a current tracker has nothing to do', () => {
  const root = makeRepo('basic')
  const before = hashTree(root)
  for (const args of [['migrate'], ['migrate', '--dry-run']]) {
    const { status, body } = cli(root, args)
    assert.equal(status, 0)
    assert.deepEqual(body, { from: 2, to: 2, steps: [] })
  }
  assert.equal(hashTree(root), before)
})

test('the migration from format 1 to 2 changes only the version in config.yaml', () => {
  const { root, dir } = gitRepo()
  const before = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8')
  const result = runMigrate(root)
  assert.deepEqual(result.data.steps, [{ from: 1, to: 2, changes: [{ path: '.issues/config.yaml', action: 'change' }] }])
  assert.equal(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), before.replace(/^version: 1$/m, 'version: 2'))
  assert.equal(git(root, 'status', '--porcelain').stdout, ' M .issues/config.yaml\n')
  assert.deepEqual(MIGRATIONS.map(({ from, to }) => [from, to]), [[1, 2]])
})

test('planMigration never copies the query index', () => {
  const { root } = setup()
  try {
    const cache = path.join(root, '.issues', '.cache')
    fs.mkdirSync(cache)
    fs.writeFileSync(path.join(cache, 'index.json'), '{}')
    const plan = planMigration({ root, trackerPath: '.issues', from: 1, to: 2, migrations: [renameLogTime] })
    assert.equal(fs.existsSync(path.join(plan.dir, '.cache')), false)
    assert.ok(plan.steps[0].changes.every((change) => !change.path.includes('.cache')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
