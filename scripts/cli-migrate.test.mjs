// local-migrate over the CLI with a fake fetch. No test here touches the network or the real user store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { linearDescriptor } from './lib/linear/adapter.mjs'
import { fakeLinear, useLinear } from './fake-hosted.mjs'
import { ACME_LABELS, ACME_TEAM, FAKE_KEY, fakeLinearFetch, fakeLinearIssues, fakeLinearProjects, fakeWorkspace } from './fake-linear-api.mjs'
import { childEnv } from './golden-helpers.mjs'
import { buildMigrationFixture, commitAll, git } from './migrate-fixture.mjs'
import { PmkitError } from './lib/errors.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { loadConfig, loadPmkitConfig } from './lib/config.mjs'
import { createLocalWriter } from './lib/local/migrate-writer.mjs'
import { readLocalSnapshot } from './lib/local/migrate-reader.mjs'
import { hashTree, makeRepo, userStoreEnv } from './test-helpers.mjs'

// gitUserEmail reads the process environment, so the in-process runs need the same git isolation as childEnv.
process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const outputs = []

function setup({ fixture = true } = {}) {
  const root = makeRepo('basic')
  const ids = fixture ? buildMigrationFixture(root).ids : null
  const env = { ...childEnv(), ...userStoreEnv().env, LINEAR_API_KEY: FAKE_KEY }
  return { root, env, ids }
}

async function cli(context, args, { fetch = fakeLinearFetch(fakeWorkspace()), adapters = {} } = {}) {
  const result = await run(args, { cwd: context.root, env: context.env, adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch }), ...adapters } })
  outputs.push(result.stdout, result.stderr)
  return result
}

const errorOf = (result) => JSON.parse(result.stdout).error
const edit = (root, file, from, to) => {
  const full = path.join(root, file)
  const text = fs.readFileSync(full, 'utf8')
  assert.match(text, from)
  fs.writeFileSync(full, text.replace(from, to))
}
/** The root-relative path of the file that holds a Local issue. */
function issueFile(root, id) {
  const file = path.join('.issues', 'issues', id, 'issue.md')
  assert.ok(fs.existsSync(path.join(root, file)), `no file for ${id}`)
  return file
}

const EXPORT = ['local-migrate', 'export', '--workspace', 'acme', '--team', 'ACME', '--json']

test('export refuses another tracker', async () => {
  const context = setup({ fixture: false })
  edit(context.root, '.pmkit/config.yaml', /^ {2}system: local$/m, '  system: jira')
  const result = await cli(context, EXPORT, { adapters: { jira: fakeLinear({ system: 'jira' }) } })
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: '`local-migrate export` works only with the Local or Linear tracker, and tracker.system is "jira"',
    nextStep: 'node scripts/pmkit.mjs --help',
  })
})

test('export refuses outside git', async () => {
  const result = await cli(setup({ fixture: false }), EXPORT)
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'this folder is not a git repository, or git is not installed')
})

test('export refuses uncommitted tracker changes', async () => {
  const context = setup()
  fs.appendFileSync(path.join(context.root, '.issues', 'config.yaml'), '# edited\n')
  const result = await cli(context, EXPORT)
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'CONFLICT')
  assert.equal(error.message, 'there are uncommitted changes under .issues')
})

test('export refuses an older format', async () => {
  const context = setup()
  edit(context.root, '.issues/config.yaml', /^version: 2$/m, 'version: 1')
  commitAll(context.root, 'old format')
  const result = await cli(context, EXPORT)
  assert.equal(result.code, 2)
  assert.deepEqual(errorOf(result), {
    code: 'NOT_SUPPORTED',
    message: 'this repository uses tracker format 1, this pmkit writes format 2',
    nextStep: '/pmkit:upgrade',
  })
})

test('export from a Linear repository reads the Local side at --path', async () => {
  const context = setup()
  useLinear(context.root)
  commitAll(context.root, 'linear')
  const result = await cli(context, ['local-migrate', 'export', '--path', 'tracker', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, `no config.yaml in ${path.join(fs.realpathSync(context.root), 'tracker')}`)
})

test('export without a Linear side asks for the workspace and the team', async () => {
  const result = await cli(setup(), ['local-migrate', 'export', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.equal(error.message, 'local-migrate export needs the Linear workspace and team')
  assert.equal(error.nextStep, 'Pass --workspace <key> --team <KEY>, or run it from a repository whose tracker.scope names them')
})

// A Linear workspace for the export: cycles on, a Fibonacci scale, and a cycle on the fixture sprint's dates.
function linearFake({ headers, start } = {}) {
  const teams = [{ ...ACME_TEAM, cyclesEnabled: true, issueEstimationType: 'fibonacci' }]
  const labels = [...ACME_LABELS, { ...ACME_LABELS[0], id: 'label-task', name: 'Task' }, { ...ACME_LABELS[0], id: 'label-chore', name: 'Chore' }]
  const issues = fakeLinearIssues({ teams, labels, ...(start ? { start } : {}) })
  const projects = fakeLinearProjects({ issues, teams })
  issues.cycles.add({ number: 1, startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z' })
  const routes = { ...fakeWorkspace({ teams, labels }), ...issues.routes, ...projects.routes }
  if (headers) {
    for (const [name, route] of Object.entries(routes)) {
      routes[name] = (body) => {
        const answer = typeof route === 'function' ? route(body) : route
        return { ...answer, headers: { ...answer.headers, ...(typeof headers === 'function' ? headers() : headers) } }
      }
    }
  }
  const fetch = fakeLinearFetch(routes)
  const mutations = () => [...issues.mutations, ...(projects.mutations ?? [])]
  return { issues, projects, fetch, mutations }
}

const TYPES = ['--status', 'in_review=In Review', '--status', 'blocked=In Progress', '--type-label', 'feature=Feature', '--type-label', 'bug=Bug', '--type-label', 'task=Task', '--type-label', 'chore=Chore']
const READY = [...EXPORT, ...TYPES]
const preview = async (context, fake) => JSON.parse((await cli(context, [...READY, '--dry-run'], { fetch: fake.fetch })).stdout)
/** The real run as the command doc runs it: the dry run, then the same flags with its digest. A refused dry run is the result. */
async function confirmed(context, args, options = {}) {
  const dry = await cli(context, [...args, '--dry-run'], options)
  if (dry.code !== 0) return dry
  options.between?.()
  return cli(context, [...args, '--expect', JSON.parse(dry.stdout).digest], options)
}

test('export refuses another actor', async () => {
  const context = setup()
  const fake = linearFake()
  const result = await cli(context, [...READY, '--as', 'ana'], { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
  assert.match(errorOf(result).message, /^Linear records every write as the owner of LINEAR_API_KEY/)
  assert.deepEqual(fake.mutations(), [])
})

test('export asks for open mappings', async () => {
  const context = setup()
  const result = await cli(context, EXPORT, { fetch: linearFake().fetch })
  assert.equal(result.code, 2, result.stdout)
  const error = errorOf(result)
  assert.equal(error.code, 'NOT_CONFIGURED')
  assert.ok(error.mappings.some((question) => question.path.startsWith('mappings.types')), JSON.stringify(error.mappings))
})

test('export --dry-run prints the full preview and writes nothing', async () => {
  const context = setup()
  const fake = linearFake()
  const before = hashTree(context.root)
  const result = await cli(context, READY.filter((arg) => arg !== '--json').concat('--dry-run'), { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  for (const section of ['export .issues/', 'source: ', 'target: ', 'labels', 'epics', 'issues', 'links', 'comments', 'will not carry over', 'digest: ', 'dry run: nothing was written']) {
    assert.ok(result.stdout.includes(section), `${section} in\n${result.stdout}`)
  }
  assert.equal(hashTree(context.root), before)
  assert.equal(fs.existsSync(path.join(context.root, '.pmkit', 'migrations')), false)
  assert.deepEqual(fake.mutations(), [])
})

test('export --dry-run --json has the preview keys and the digest', async () => {
  const context = setup()
  const data = await preview(context, linearFake())
  assert.equal(data.direction, 'export')
  assert.match(data.digest, /^sha256:[0-9a-f]{64}$/)
  assert.ok(data.records.issue.length > 0)
})

test('problems refuse the run with all of them in the JSON error', async () => {
  const context = setup()
  const { ids } = context
  edit(context.root, issueFile(context.root, ids.root), /^parent: .*$/m, `parent: ${ids.grandchild}`)
  commitAll(context.root, 'loop')
  const fake = linearFake()
  const result = await confirmed(context, READY, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.ok(error.problems.length >= 1)
  assert.ok(error.message.includes(error.problems[0].message))
  assert.deepEqual(fake.mutations(), [])
})

test('export --expect with a changed plan refuses before any write', async () => {
  const context = setup()
  const fake = linearFake()
  const { digest } = (await preview(context, fake))
  edit(context.root, issueFile(context.root, context.ids.child), /^title: .*$/m, 'title: Read the config file again')
  commitAll(context.root, 'retitle')
  const result = await cli(context, [...READY, '--expect', digest], { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  assert.equal(errorOf(result).code, 'CONFLICT')
  assert.deepEqual(fake.mutations(), [])
})

test('export without --expect refuses before any write and names the dry run', async () => {
  const context = setup()
  const fake = linearFake()
  const result = await cli(context, READY, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.nextStep, /pmkit local-migrate export --dry-run/)
  assert.deepEqual(fake.mutations(), [])
  assert.ok(!fs.existsSync(path.join(context.root, '.pmkit', 'migrations')), 'no map is written')
})

test('export writes the map and every record', async () => {
  const context = setup()
  const fake = linearFake()
  const { digest, records } = (await preview(context, fake))
  const result = await cli(context, [...READY, '--expect', digest], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const file = path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml')
  assert.ok(fs.existsSync(file), JSON.parse(result.stdout).map)
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /^finished: \S+/m)
  const total = Object.values(records).reduce((sum, list) => sum + list.filter((record) => record.action === 'create').length, 0)
  assert.equal((text.match(/state: done/g) ?? []).length, total)
  const nodes = fake.issues.nodes()
  assert.equal(nodes.length, records.issue.length)
  const child = nodes.find((node) => node.title === 'Read the config file')
  assert.ok(child.parent, 'the child keeps its parent')
  assert.ok(child.cycle, 'the child sits in the cycle')
  assert.ok(nodes.every((node) => node.createdAt), 'every issue has createdAt')
  assert.ok(fake.mutations().includes('PmkitRelationCreate'))
  const measured = nodes.find((node) => node.title === 'Measure the rate limit')
  assert.equal(measured.estimate, 3)
  const creates = fake.fetch.calls.map((call) => call.body).filter((body) => /mutation PmkitIssueCreate/.test(body.query)).map((body) => body.variables.input)
  assert.match(creates.find((input) => input.title === 'Measure the rate limit').completedAt ?? '', /^\d{4}-\d{2}-\d{2}T/, 'the done issue keeps completedAt')
  const bodies = fake.issues.comments.map((comment) => comment.body)
  assert.ok(bodies.length > 0)
  assert.ok(bodies.every((body) => /^Comment by \S.* on \d{4}-\d{2}-\d{2} in \S+\n\n/.test(body)), bodies.join('\n---\n'))
  assert.match(JSON.parse(result.stdout).next, /^commit \.pmkit\/migrations\/2026-10-23-export-linear\.yaml$/)
})

test('a failed export resumes and creates nothing twice', async () => {
  const context = setup()
  const fake = linearFake()
  const { digest } = (await preview(context, fake))
  fake.issues.unconfirm('PmkitRelationCreate', { applied: false })
  const failed = await cli(context, [...READY, '--expect', digest], { fetch: fake.fetch })
  assert.equal(failed.code, 2, failed.stdout)
  const file = path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml')
  assert.match(fs.readFileSync(file, 'utf8'), /state: failed/)
  const issues = fake.issues.nodes().length
  const again = await confirmed(context, READY, { fetch: fake.fetch })
  assert.equal(again.code, 0, again.stdout)
  assert.equal(fake.issues.nodes().length, issues)
  assert.match(fs.readFileSync(file, 'utf8'), /^finished: \S+/m)
})

test('a second export sends only the new issues and links them to the old ones', async () => {
  const context = setup()
  const fake = linearFake()
  assert.equal((await confirmed(context, READY, { fetch: fake.fetch })).code, 0)
  commitAll(context.root, 'map')
  const { blocker } = context.ids
  const created = await run(['issues', 'create', '--title', 'Follow the blocker', '--type', 'task', '--as', 'fred', '--json'], { cwd: context.root, env: context.env })
  assert.equal(created.code, 0, created.stdout)
  const id = JSON.parse(created.stdout).after?.id ?? JSON.parse(created.stdout).id
  const linked = await run(['issues', 'link', blocker, id, '--kind', 'blocks', '--as', 'fred', '--json'], { cwd: context.root, env: context.env })
  assert.equal(linked.code, 0, linked.stdout)
  commitAll(context.root, 'new issue')
  const before = { issues: fake.issues.mutations.length, projects: fake.projects.mutations.length }
  const result = await confirmed(context, READY, { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  assert.ok(fs.existsSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear-2.yaml')))
  assert.deepEqual(fake.issues.mutations.slice(before.issues), ['PmkitIssueCreate', 'PmkitRelationCreate'])
  assert.deepEqual(fake.projects.mutations.slice(before.projects), [])
  const first = fs.readFileSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml'), 'utf8')
  const relation = fake.fetch.calls.map((call) => call.body).filter((body) => /mutation PmkitRelationCreate/.test(body.query)).at(-1)
  const ends = [relation.variables.input.issueId, relation.variables.input.relatedIssueId]
  assert.ok(ends.some((uuid) => first.includes(uuid)), `one end of ${ends} comes from the first map`)
})

test('export stops at the reserve', async () => {
  const context = setup()
  // Linear counts down from 119, so the reads leave a few writes before the reserve of 100.
  let remaining = 120
  const fake = linearFake({ headers: () => ({ 'x-ratelimit-requests-remaining': String(--remaining), 'x-ratelimit-requests-reset': String(Date.parse('2026-10-23T13:00:00Z')) }) })
  const result = await confirmed(context, READY, { fetch: fake.fetch, between: () => { remaining = 120 } })
  assert.equal(result.code, 2, result.stdout)
  assert.equal(errorOf(result).code, 'RATE_LIMITED')
  const map = fs.readFileSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml'), 'utf8')
  assert.match(map, /state: done/)
  assert.doesNotMatch(map, /^finished: \d/m)
})

const IMPORT = ['local-migrate', 'import', '--workspace', 'acme', '--team', 'ACME', '--json']

const STATE = { backlog: { id: 'state-1', name: 'Backlog', type: 'backlog' }, progress: { id: 'state-3', name: 'In Progress', type: 'started' }, done: { id: 'state-8', name: 'Done', type: 'completed' } }

// An empty Local tracker in git, and a Linear team with issues, relations of each kind, a project with an update and a
// child, a comment thread with a resolved root, a history move, and a user (user-1) that no Local member names.
function importSetup() {
  const context = setup({ fixture: false })
  commitAll(context.root, 'empty tracker')
  const fake = linearFake()
  const a = fake.issues.seed({ title: 'Read the config' })
  const b = fake.issues.seed({ title: 'Write the config' })
  fake.issues.relate('blocks', a.id, b.id)
  fake.projects.seed({ id: 'p-1', name: 'Config epic', teamIds: [ACME_TEAM.id] })
  fake.projects.seedUpdate('p-1', { id: 'u-1', body: 'Fine', health: 'onTrack' })
  const c = fake.issues.seed({ title: 'Ship the config', projectId: 'p-1', stateId: STATE.done.id }, { createdAt: '2026-10-01T00:00:00.000Z' })
  fake.issues.history(c.id, { createdAt: '2026-10-02T00:00:00.000Z', fromState: STATE.backlog, toState: STATE.progress })
  fake.issues.history(c.id, { createdAt: '2026-10-05T12:00:00.000Z', fromState: STATE.progress, toState: STATE.done })
  fake.issues.relate('related', a.id, c.id)
  const d = fake.issues.seed({ title: 'Read the config twice' })
  fake.issues.relate('duplicate', d.id, a.id)
  const root = fake.issues.comment(a.id, { body: 'Which file?', resolvedAt: '2026-10-03T00:00:00.000Z' })
  fake.issues.comment(a.id, { body: 'config.yaml', parentId: root.id })
  fake.issues.comment(a.id, { body: 'Done reading' })
  return { context, fake }
}

/** Wraps a writer so the nth create of one kind throws UPSTREAM, as a dropped connection would. */
function failOnCall(writer, kind, nth) {
  let calls = 0
  return {
    ...writer,
    async create(name, ...rest) {
      if (name === kind && ++calls === nth) throw new PmkitError('UPSTREAM', `the test writer fails on ${kind} ${nth}`, 'Run it again')
      return writer.create(name, ...rest)
    },
  }
}
const failingLocal = { local: { ...ADAPTERS.local, migrateWriter: (deps) => failOnCall(createLocalWriter(deps), 'comment', 3) } }

/** The issue folders of the Local tracker. */
const heldIssues = (root) => fs.readdirSync(path.join(root, '.issues', 'issues'), { withFileTypes: true }).filter((entry) => entry.isDirectory())

/** Every comment file of the Local tracker, root-relative. */
function commentFiles(root) {
  const base = path.join(root, '.issues')
  return fs.readdirSync(base, { recursive: true }).filter((file) => file.split(path.sep).includes('comments') && file.endsWith('.md'))
}

test('import refuses a tracker that holds issues', async () => {
  const context = setup()
  const fake = linearFake()
  const result = await confirmed(context, IMPORT, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  assert.deepEqual(errorOf(result), {
    code: 'CONFLICT',
    message: 'import needs a Local tracker with no issues and no epics',
    nextStep: 'Move the old records out with git rm -r .issues/issues .issues/epics .issues/sprints, commit, and run the import again',
  })
})

test('import --dry-run lists new members and writes nothing', async () => {
  const { context, fake } = importSetup()
  const before = hashTree(context.root)
  const result = await cli(context, IMPORT.filter((arg) => arg !== '--json').concat('--dry-run'), { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /new member user-1/)
  assert.match(result.stdout, /dry run: nothing was written/)
  assert.equal(hashTree(context.root), before)
  assert.deepEqual(fake.mutations(), [])
})

test('import without --expect refuses before any write and names the dry run', async () => {
  const { context, fake } = importSetup()
  const before = hashTree(context.root)
  const result = await cli(context, IMPORT, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.match(error.nextStep, /pmkit local-migrate import --dry-run/)
  assert.equal(hashTree(context.root), before)
})

test('import writes every record and validates', async () => {
  const { context, fake } = importSetup()
  const result = await confirmed(context, IMPORT, { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  assert.deepEqual(fake.mutations(), [])
  const validated = await run(['validate', '--json'], { cwd: context.root, env: context.env })
  assert.equal(validated.code, 0, validated.stdout)
  const listed = await run(['issues', 'list', '--json'], { cwd: context.root, env: context.env })
  const issues = JSON.parse(listed.stdout).issues ?? JSON.parse(listed.stdout)
  assert.equal(issues.length, 4)
  const byTitle = (title) => issues.find((issue) => issue.title === title)
  const reader = byTitle('Read the config')
  const text = (issue) => fs.readFileSync(path.join(context.root, issueFile(context.root, issue.id)), 'utf8')
  assert.match(text(byTitle('Write the config')), new RegExp(`blocked_by:[\\s\\S]*${reader.id}`), 'the blocked issue names its blocker')
  assert.match(text(byTitle('Ship the config')) + text(reader), new RegExp(`related:[\\s\\S]*(${reader.id}|${byTitle('Ship the config').id})`))
  assert.match(text(byTitle('Read the config twice')), new RegExp(`duplicate_of:[\\s\\S]*${reader.id}`))
  const committed = spawnSync('git', ['show', 'HEAD:.issues/config.yaml'], { cwd: context.root, encoding: 'utf8' }).stdout
  assert.doesNotMatch(committed, /Test User/)
  assert.match(fs.readFileSync(path.join(context.root, '.issues', 'config.yaml'), 'utf8'), /Test User/, 'user-1 becomes a new member')
  assert.match(JSON.parse(result.stdout).next, /^commit \.issues\/ and \.pmkit\/migrations\/2026-10-23-import-linear\.yaml$/)
})

test('import never commits', async () => {
  const { context, fake } = importSetup()
  assert.equal((await confirmed(context, IMPORT, { fetch: fake.fetch })).code, 0)
  const git = (...args) => spawnSync('git', args, { cwd: context.root, encoding: 'utf8' }).stdout
  const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((line) => line.slice(3))
  assert.ok(changed.length > 0)
  assert.ok(changed.every((file) => file.startsWith('.issues/') || file === '.pmkit/migrations/2026-10-23-import-linear.yaml'), changed.join('\n'))
  assert.ok(changed.includes('.pmkit/migrations/2026-10-23-import-linear.yaml'))
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1')
})

test('imported history gives flow metrics', async () => {
  const { context, fake } = importSetup()
  assert.equal((await confirmed(context, IMPORT, { fetch: fake.fetch })).code, 0)
  const result = await run(['metrics', 'cycle-time', '--since', '2026-10-01', '--until', '2026-10-31', '--json'], { cwd: context.root, env: context.env })
  assert.equal(result.code, 0, result.stdout)
  const listed = JSON.parse((await run(['issues', 'list', '--json'], { cwd: context.root, env: context.env })).stdout)
  const shipped = (listed.issues ?? listed).find((issue) => issue.title === 'Ship the config')
  assert.match(result.stdout, new RegExp(shipped.id))
})

test('import resumes over its own uncommitted files', async () => {
  const { context, fake } = importSetup()
  const failed = await confirmed(context, IMPORT, { fetch: fake.fetch, adapters: failingLocal })
  assert.equal(failed.code, 2, failed.stdout)
  assert.equal(commentFiles(context.root).length, 2)
  const resumed = await confirmed(context, IMPORT, { fetch: fake.fetch })
  assert.equal(resumed.code, 0, resumed.stdout)
  assert.equal(commentFiles(context.root).length, 3, commentFiles(context.root).join('\n'))
  assert.match(fs.readFileSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-import-linear.yaml'), 'utf8'), /^finished: \S+/m)
  assert.equal((await run(['validate', '--json'], { cwd: context.root, env: context.env })).code, 0)
})

test('a resume refuses when HEAD moved', async () => {
  const { context, fake } = importSetup()
  assert.equal((await confirmed(context, IMPORT, { fetch: fake.fetch, adapters: failingLocal })).code, 2)
  fs.writeFileSync(path.join(context.root, 'NOTES.md'), 'notes\n')
  git(context.root, 'add', 'NOTES.md')
  git(context.root, 'commit', '-q', '-m', 'notes')
  const result = await confirmed(context, IMPORT, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  assert.deepEqual(errorOf(result), { code: 'CONFLICT', message: 'there are uncommitted changes under .issues', nextStep: 'Commit or discard the changes under .issues first' })
})

test('import on a Linear repository uses --path', async () => {
  const context = setup({ fixture: false })
  useLinear(context.root)
  edit(context.root, '.pmkit/config.yaml', /^ {4}workspace: acme$/m, '    workspace: acme\n    team: ACME')
  commitAll(context.root, 'linear tracker')
  const fake = linearFake()
  fake.issues.seed({ title: 'Read the config' })
  const result = await confirmed(context, ['local-migrate', 'import', '--path', '.issues', '--json'], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  assert.equal(heldIssues(context.root).length, 1)
  assert.match(JSON.parse(result.stdout).next, /^commit \.issues\/ and /)
})

const STATUS = ['local-migrate', 'status', '--json']
const UNDO = ['local-migrate', 'undo', '--json']

/** An export over a fake whose clock starts before NOW, so only a later edit counts as a change. */
async function exported() {
  const context = setup()
  const fake = linearFake({ start: '2026-10-23T00:00:00.000Z' })
  const { records } = await preview(context, fake)
  const result = await confirmed(context, READY, { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const created = (kind) => records[kind].filter((record) => record.action === 'create').length
  return { context, fake, counts: { issue: created('issue'), epic: created('epic'), label: created('label') } }
}

test('status prints the counts and the next step of an unfinished map', async () => {
  const context = setup()
  const fake = linearFake()
  fake.issues.unconfirm('PmkitRelationCreate', { applied: false })
  assert.equal((await confirmed(context, READY, { fetch: fake.fetch })).code, 2)
  const counting = fakeLinearFetch(fakeWorkspace())
  const result = await cli(context, STATUS, { fetch: counting })
  assert.equal(result.code, 0, result.stdout)
  const data = JSON.parse(result.stdout)
  assert.equal(data.file, '.pmkit/migrations/2026-10-23-export-linear.yaml')
  assert.equal(data.direction, 'export')
  assert.equal(data.finished, null)
  assert.ok(data.kinds.issue.done > 0)
  assert.equal(data.failed.length, 1)
  assert.match(data.next, /local-migrate export/)
  assert.deepEqual(counting.calls, [], 'status sends no request')
  const text = (await cli(context, ['local-migrate', 'status'], { fetch: counting })).stdout
  assert.match(text, /not finished/)
  assert.match(text, /next: /)
})

test('status without a map is NOT_FOUND', async () => {
  const context = setup()
  const result = await cli(context, STATUS)
  assert.notEqual(result.code, 0)
  assert.equal(errorOf(result).code, 'NOT_FOUND')
  assert.match(errorOf(result).message, /no migration map in \.pmkit\/migrations/)
})

test('undo --dry-run lists every record it deletes and marks the changed ones', async () => {
  const { context, fake, counts } = await exported()
  const changed = fake.issues.records.find((record) => record.title === 'Measure the rate limit')
  changed.updatedAt = '2026-10-24T09:00:00.000Z'
  const before = fake.mutations().length
  const result = await cli(context, [...UNDO, '--dry-run'], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const data = JSON.parse(result.stdout)
  const byKind = (kind) => data.removals.filter((removal) => removal.kind === kind)
  assert.equal(byKind('issue').length, counts.issue)
  assert.equal(byKind('epic').length, counts.epic)
  assert.equal(byKind('label').length, counts.label)
  assert.deepEqual(data.removals.filter((removal) => removal.changed).map((removal) => removal.uuid), [changed.id])
  assert.equal(data.requests, 10 + counts.issue + counts.epic + counts.label)
  assert.match(data.digest, /^sha256:/)
  assert.equal(fake.mutations().length, before, 'no mutation')
  const text = (await cli(context, ['local-migrate', 'undo', '--dry-run'], { fetch: fake.fetch })).stdout
  assert.match(text, /changed since the migration/)
  assert.match(text, /dry run: nothing was written/)
  assert.doesNotMatch(fs.readFileSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml'), 'utf8'), /state: removed/)
})

test('undo without --expect refuses before any delete', async () => {
  const { context, fake } = await exported()
  const before = fake.mutations().length
  const result = await cli(context, UNDO, { fetch: fake.fetch })
  assert.equal(result.code, 2, result.stdout)
  assert.match(errorOf(result).nextStep ?? errorOf(result).next_step ?? '', /--dry-run/)
  assert.equal(fake.mutations().length, before)
})

test('undo deletes what the export created', async () => {
  const { context, fake } = await exported()
  const { digest } = JSON.parse((await cli(context, [...UNDO, '--dry-run'], { fetch: fake.fetch })).stdout)
  const result = await cli(context, [...UNDO, '--expect', digest], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  assert.ok(fake.issues.records.every((record) => record.trashed), 'every exported issue is in the trash')
  assert.ok(fake.mutations().includes('PmkitProjectDelete'))
  const deleted = fake.fetch.calls.map((call) => call.body).filter((body) => /mutation PmkitLabelDelete/.test(body.query)).map((body) => body.variables.id)
  assert.ok(deleted.length > 0, 'the created label is deleted')
  assert.ok(!deleted.some((id) => ACME_LABELS.some((label) => label.id === id) || id === 'label-task' || id === 'label-chore'), 'a label the team had stays')
  const { records } = parseYaml(fs.readFileSync(path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml'), 'utf8'))
  const entries = [...Object.values(records.issue), ...Object.values(records.epic), ...Object.values(records.label).filter((entry) => entry.created)]
  assert.ok(entries.every((entry) => entry.state === 'removed'), 'each entry is removed')
  assert.equal(JSON.parse(result.stdout).removed, entries.length)
})

test('undo resumes after an interruption', async () => {
  const { context, fake } = await exported()
  const { digest } = JSON.parse((await cli(context, [...UNDO, '--dry-run'], { fetch: fake.fetch })).stdout)
  let deletes = 0
  const failing = async (url, init) => {
    if (/mutation PmkitIssueDelete/.test(JSON.parse(init.body).query) && ++deletes === 2) {
      return new Response(JSON.stringify({ errors: [{ message: 'boom', extensions: { code: 'INVALID_INPUT' } }] }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return fake.fetch(url, init)
  }
  const failed = await cli(context, [...UNDO, '--expect', digest], { fetch: failing })
  assert.equal(failed.code, 2, failed.stdout)
  const map = path.join(context.root, '.pmkit', 'migrations', '2026-10-23-export-linear.yaml')
  assert.equal((fs.readFileSync(map, 'utf8').match(/state: removed/g) ?? []).length, 1)
  const again = JSON.parse((await cli(context, [...UNDO, '--dry-run'], { fetch: fake.fetch })).stdout)
  const result = await cli(context, [...UNDO, '--expect', again.digest], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const ids = fake.fetch.calls.map((call) => call.body).filter((body) => /mutation PmkitIssueDelete/.test(body.query)).map((body) => body.variables.id)
  assert.equal(ids.length, new Set(ids).size, 'each delete once')
  assert.ok(fake.issues.records.every((record) => record.trashed))
})

test('undo on an import map prints the git commands and writes nothing', async () => {
  const { context, fake } = importSetup()
  assert.equal((await confirmed(context, IMPORT, { fetch: fake.fetch })).code, 0)
  const before = hashTree(context.root)
  const counting = fakeLinearFetch(fakeWorkspace())
  const result = await cli(context, UNDO, { fetch: counting })
  assert.equal(result.code, 0, result.stdout)
  assert.deepEqual(JSON.parse(result.stdout).commands, ['git restore --source=HEAD -- .issues .pmkit/migrations', 'git clean -fd -- .issues'])
  assert.deepEqual(counting.calls, [])
  assert.equal(hashTree(context.root), before)
})

const SWITCH = ['local-migrate', 'switch', '--json']
const CONFIG = '.pmkit/config.yaml'
const readConfig = (root) => fs.readFileSync(path.join(root, CONFIG), 'utf8')
const onlyMap = (root) => {
  const dir = path.join(root, '.pmkit', 'migrations')
  const [name] = fs.readdirSync(dir)
  return { file: `.pmkit/migrations/${name}`, map: parseYaml(fs.readFileSync(path.join(dir, name), 'utf8')) }
}
async function imported() {
  const { context, fake } = importSetup()
  assert.equal((await confirmed(context, IMPORT, { fetch: fake.fetch })).code, 0)
  return { context, fake }
}

test('switch --to linear --dry-run prints the diff and writes nothing', async () => {
  const { context } = await exported()
  const before = hashTree(context.root)
  const counting = fakeLinearFetch(fakeWorkspace())
  const result = await cli(context, [...SWITCH, '--to', 'linear', '--dry-run'], { fetch: counting })
  assert.equal(result.code, 0, result.stdout)
  const data = JSON.parse(result.stdout)
  assert.equal(data.from, 'local')
  assert.equal(data.to, 'linear')
  assert.equal(data.written, false)
  assert.ok(data.changes.includes('tracker.system'))
  assert.match(data.diff, /^-  system: local$/m)
  assert.match(data.diff, /^\+  system: linear$/m)
  assert.equal(hashTree(context.root), before)
  assert.deepEqual(counting.calls, [], 'switch sends no request')
  const text = (await cli(context, ['local-migrate', 'switch', '--to', 'linear', '--dry-run'], { fetch: counting })).stdout
  assert.match(text, /\+ {2}system: linear/)
  assert.match(text, /nothing written/)
})

test('switch --to linear writes the system, the scope and the mappings', async () => {
  const { context } = await exported()
  const { file, map } = onlyMap(context.root)
  const issues = hashTree(path.join(context.root, '.issues'))
  const result = await cli(context, [...SWITCH, '--to', 'linear'])
  assert.equal(result.code, 0, result.stdout)
  const data = JSON.parse(result.stdout)
  assert.equal(data.file, file)
  assert.equal(data.written, true)
  const { pmkit, system } = loadPmkitConfig(context.root, { adapters: { ...ADAPTERS, linear: linearDescriptor({ fetch: fakeLinearFetch(fakeWorkspace()) }) } })
  assert.equal(system, 'linear')
  assert.deepEqual(pmkit.tracker.scope, { workspace: 'acme', team: 'ACME' })
  for (const key of ['status', 'fields', 'types']) if (map.mappings[key] !== undefined) assert.deepEqual(pmkit.mappings[key], map.mappings[key], key)
  assert.equal(hashTree(path.join(context.root, '.issues')), issues)
  assert.equal(git(context.root, 'status', '--porcelain', '--', CONFIG).trim(), `M ${CONFIG}`, 'switch never commits')
})

test('switch refuses an unfinished map', async () => {
  const { context } = await exported()
  const { file } = onlyMap(context.root)
  edit(context.root, file, /^finished: .*$/m, 'finished: null')
  const before = readConfig(context.root)
  const result = await cli(context, [...SWITCH, '--to', 'linear'])
  assert.notEqual(result.code, 0)
  assert.equal(errorOf(result).code, 'CONFLICT')
  assert.equal(errorOf(result).message, `the migration in ${file} is not finished`)
  assert.equal(errorOf(result).nextStep, 'Run pmkit local-migrate status')
  assert.equal(readConfig(context.root), before)
})

test('switch refuses a map with failed records', async () => {
  const { context } = await exported()
  const { file } = onlyMap(context.root)
  edit(context.root, file, /state: done/, 'state: failed')
  const before = readConfig(context.root)
  const result = await cli(context, [...SWITCH, '--to', 'linear', '--file', file])
  assert.notEqual(result.code, 0)
  assert.equal(errorOf(result).code, 'CONFLICT')
  assert.equal(errorOf(result).message, `the migration in ${file} has 1 failed record`)
  assert.equal(errorOf(result).nextStep, 'Run pmkit local-migrate status')
  assert.equal(readConfig(context.root), before)
})

test('switch --to local needs an import map', async () => {
  const { context } = await exported()
  const before = readConfig(context.root)
  for (const args of [['--to', 'local'], ['--to', 'local', '--file', onlyMap(context.root).file]]) {
    const result = await cli(context, [...SWITCH, ...args])
    assert.notEqual(result.code, 0)
    assert.equal(errorOf(result).code, 'INVALID_INPUT')
    assert.equal(errorOf(result).message, 'switch --to local needs a finished import map')
  }
  const bad = await cli(context, [...SWITCH, '--to', 'jira'])
  assert.equal(errorOf(bad).code, 'INVALID_INPUT')
  assert.equal(readConfig(context.root), before)
})

test('switch to the system the file already names writes nothing and says so', async () => {
  const { context } = await imported()
  const before = hashTree(context.root)
  const result = await cli(context, [...SWITCH, '--to', 'local'])
  assert.equal(result.code, 0, result.stdout)
  const data = JSON.parse(result.stdout)
  assert.equal(data.written, false)
  assert.deepEqual(data.changes, [])
  assert.equal(hashTree(context.root), before)
  const text = (await cli(context, ['local-migrate', 'switch', '--to', 'local'])).stdout
  assert.match(text, /tracker\.system is already local/)
})

test('switch --to local writes the system and the path and keeps scope and mappings', async () => {
  const { context } = await imported()
  edit(context.root, CONFIG, /^ {2}system: local\n {2}path: \.issues$/m, '  system: linear\n  scope:\n    workspace: acme\n    team: ACME')
  fs.appendFileSync(path.join(context.root, CONFIG), 'mappings:\n  status:\n    in_review: In Review\n')
  const result = await cli(context, [...SWITCH, '--to', 'local'])
  assert.equal(result.code, 0, result.stdout)
  assert.equal(JSON.parse(result.stdout).written, true)
  const after = parseYaml(readConfig(context.root))
  assert.equal(after.tracker.system, 'local')
  assert.equal(after.tracker.path, '.issues')
  assert.deepEqual(after.tracker.scope, { workspace: 'acme', team: 'ACME' })
  assert.deepEqual(after.mappings, { status: { in_review: 'In Review' } })
})

/** A second repository from `basic` with the export map and the tracker config of the exported one, committed. */
function secondRepository(source) {
  const { file } = onlyMap(source.root)
  const target = setup({ fixture: false })
  fs.mkdirSync(path.join(target.root, '.pmkit', 'migrations'), { recursive: true })
  fs.copyFileSync(path.join(source.root, file), path.join(target.root, file))
  fs.copyFileSync(path.join(source.root, '.issues', 'config.yaml'), path.join(target.root, '.issues', 'config.yaml'))
  commitAll(target.root, 'export map')
  return target
}

test('import into a Local repository takes the mappings of the export map', async () => {
  const { context: source, fake } = await exported()
  const target = secondRepository(source)
  const result = await cli(target, [...IMPORT, '--dry-run'], { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const { records } = JSON.parse(result.stdout)
  const measured = records.issue.find((record) => record.fields.title === 'Measure the rate limit')
  assert.equal(measured.fields.type, 'task')
  assert.equal(measured.fields.estimate, 3)
  assert.deepEqual(measured.fields.labels ?? [], [])
})

// The fields that may differ after a round trip, each a row of the losses tables. Linear replaces the history, so an
// issue loses the completion time that Local reads from its events, and an epic its creation time. Linear names the
// branch, the export drops issue milestones, and an estimate outside the scale is dropped. Status updates are dated at
// the migration and authored by the key owner, so the test compares only their health and body. The export reuses the
// cycle of the sprint's dates and writes neither its name nor its goal (no row covers this yet).
const ROUND_TRIP_LOSSES = { issues: ['completed', 'branch', 'milestone', 'estimate'], epics: ['created', 'updates'], sprints: ['name', 'goal'] }

/** The fields of two records with the same id that differ, minus the allowed losses. */
function changedFields(before, after, allowed) {
  return Object.keys({ ...before, ...after }).filter((key) => !allowed.includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
}

test('export then import gives back the ids, parents, blockers and links', async () => {
  const { context: source, fake } = await exported()
  const target = secondRepository(source)
  const result = await confirmed(target, IMPORT, { fetch: fake.fetch })
  assert.equal(result.code, 0, result.stdout)
  const read = (root) => readLocalSnapshot({ root, config: loadConfig(root) })
  const before = read(source.root)
  const after = read(target.root)
  const byId = (list) => new Map(list.map((record) => [record.id, record]))

  for (const kind of ['issues', 'epics', 'sprints']) {
    const back = byId(after[kind])
    assert.deepEqual([...back.keys()].sort(), before[kind].map((record) => record.id).sort(), `the ${kind} ids round-trip`)
    for (const record of before[kind]) assert.deepEqual(changedFields(record, back.get(record.id), ROUND_TRIP_LOSSES[kind]), [], `${kind} ${record.id}`)
  }
  const issues = byId(after.issues)
  const role = Object.fromEntries(before.issues.map((issue) => [issue.title, issue.id]))
  assert.equal(issues.get(role['Add the config loader']).parent, before.epics[0].id)
  assert.equal(issues.get(role['Parse the YAML subset']).parent, role['Read the config file'])
  assert.equal(issues.get(role['Old spike']).archived, true)
  assert.deepEqual(after.links, before.links)
  assert.ok(after.links.length >= 3)
  assert.deepEqual(after.sprints.map(({ start, end }) => [start, end]), [['2026-11-02', '2026-11-15']])

  const comment = ({ id, ...rest }) => rest
  assert.deepEqual(after.comments.map(comment), before.comments.map(comment), 'bodies, authors, replies and the resolved thread')
  assert.ok(after.comments.some((entry) => entry.author === 'ada' && entry.resolved))
  const updates = (snapshot) => snapshot.epics.flatMap((epic) => epic.updates.map(({ health, body }) => ({ health, body })))
  assert.deepEqual(updates(after), updates(before))
  const people = byId(after.people)
  for (const person of before.people) assert.deepEqual(people.get(person.id), person)
})

test('no output holds the key', () => {
  assert.ok(outputs.length > 0)
  for (const text of outputs) assert.doesNotMatch(text, new RegExp(FAKE_KEY))
})
