import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashTree, makeRepo } from './test-helpers.mjs'

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pmkit.mjs')

function baseEnv() {
  const env = {
    ...process.env,
    PMKIT_USER: 'fred',
    PMKIT_NOW: '2026-10-23T12:00:00Z',
    PMKIT_SEED: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  }
  return env
}

function run(cwd, args, { env = {}, input } = {}) {
  const merged = { ...baseEnv(), ...env }
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key]
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, env: merged, input, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const json = (cwd, args, options) => {
  const result = run(cwd, [...args, '--json'], options)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

test('init scaffolds every file in an empty git repo and refuses a second run with CONFLICT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-init-'))
  git(dir, 'init', '-q')
  const first = run(dir, ['init', '--tracker', 'local', '--member', 'fred', '--name', 'Fred', '--email', 'f@x.dev'])
  assert.equal(first.status, 0, first.stderr)
  for (const file of [
    '.pmkit/config.yaml', '.issues/config.yaml', '.issues/.gitattributes', '.issues/.gitignore',
    '.issues/issues/.gitkeep', '.issues/epics/.gitkeep', '.issues/sprints/.gitkeep', '.issues/docs/.gitkeep',
  ]) assert.ok(fs.existsSync(path.join(dir, file)), `${file} exists`)
  assert.match(fs.readFileSync(path.join(dir, '.pmkit/config.yaml'), 'utf8'), /system: none/)
  const members = json(dir, ['discover']).members
  assert.deepEqual(members.map((m) => [m.id, m.name, m.email]), [['fred', 'Fred', 'f@x.dev']])
  const second = run(dir, ['init', '--tracker', 'local', '--json'])
  assert.equal(second.status, 2)
  assert.equal(JSON.parse(second.stdout).error.code, 'CONFLICT')
})

test('init --dry-run lists the files and writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-init-'))
  const result = run(dir, ['init', '--root', dir, '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\.pmkit\/config\.yaml/)
  assert.equal(fs.readdirSync(dir).length, 0)
})

test('init takes the GitHub repo from the origin remote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-init-'))
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', 'git@github.com:fredsvanelli/skills.git')
  assert.equal(run(dir, ['init', '--git-host', 'github', '--prefix', 'ABC']).status, 0)
  const text = fs.readFileSync(path.join(dir, '.pmkit/config.yaml'), 'utf8')
  assert.match(text, /system: github/)
  assert.match(text, /repo: fredsvanelli\/skills/)
  assert.match(fs.readFileSync(path.join(dir, '.issues/config.yaml'), 'utf8'), /id_prefix: ABC/)
})

test('issues create prints an issue with an id and issues list returns it', () => {
  const root = makeRepo('basic')
  const created = json(root, ['issues', 'create', '--title', 'First'])
  assert.match(created.after.id, /^ISS-[0-9A-Z]{4}$/)
  assert.equal(created.before, null)
  const listed = json(root, ['issues', 'list'])
  assert.deepEqual(listed.issues.map((issue) => issue.id), [created.after.id])
  assert.deepEqual(listed.problems, [])
  const text = run(root, ['issues', 'list'])
  assert.match(text.stdout, /ID\s+\| Title\s+\| Status\s+\| Assignee\s+\| Estimate\s+\| Sprint/)
  assert.match(text.stdout, new RegExp(`${created.after.id}\\s+\\| First\\s+\\| backlog`))
})

test('issues move prints status: backlog → in_progress', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  const moved = run(root, ['issues', 'move', after.id, 'in_progress'])
  assert.equal(moved.status, 0, moved.stderr)
  assert.match(moved.stdout, /status: backlog → in_progress/)
})

test('issues update --dry-run prints the change and leaves the repo byte-identical', () => {
  const root = makeRepo('basic')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  const before = hashTree(root)
  const result = run(root, ['issues', 'update', after.id, '--priority', 'high', '--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /priority: \(none\) → high/)
  assert.match(result.stdout, /dry run/)
  assert.equal(hashTree(root), before)
})

test('every write is byte-identical on --dry-run', () => {
  const root = makeRepo('team')
  const commentFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-body-')), 'c.md')
  fs.writeFileSync(commentFile, 'A comment.')
  const before = hashTree(root)
  const dry = (...args) => {
    const result = run(root, [...args, '--dry-run'])
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`)
  }
  dry('issues', 'create', '--title', 'New')
  dry('issues', 'move', 'ISS-3F7H', 'done')
  dry('issues', 'assign', 'ISS-3F7H', 'ana')
  dry('issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'related')
  dry('issues', 'parent', 'ISS-3F7H', 'none')
  dry('issues', 'archive', 'ISS-3F7H')
  dry('issues', 'log-time', 'ISS-3F7H', '30')
  dry('cycle', 'open', '--start', '2026-11-02')
  dry('cycle', 'add', 'ISS-3F7H', '--to', 'none')
  dry('cycle', 'capacity', '2026-10-12', '--set', 'fred=3')
  dry('cycle', 'close', '2026-10-12')
  dry('epic', 'create', '--title', 'E')
  dry('issues', 'update', 'ISS-3F7H', '--priority', 'urgent', '--estimate', '8')
  dry('issues', 'comment', 'ISS-3F7H', '--body-file', commentFile)
  dry('epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', commentFile)
  assert.equal(hashTree(root), before)
})

test('issues get on an unknown id exits 2 with error and next on stderr', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'get', 'NOPE-1234'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^error: /m)
  assert.match(result.stderr, /^next: /m)
  assert.equal(result.stdout, '')
})

test('with --json the same error is a JSON object on stdout', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'get', 'NOPE-1234', '--json'])
  assert.equal(result.status, 2)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_FOUND')
  assert.ok(error.message)
  assert.ok(error.nextStep)
})

test('a bad PMKIT_NOW is a usage error', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'create', '--title', 'x'], { env: { PMKIT_NOW: 'not a date' } })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /^error: /m)
})

test('cycle open, add and current', () => {
  const root = makeRepo('basic')
  const { after: issue } = json(root, ['issues', 'create', '--title', 'First'])
  const opened = json(root, ['cycle', 'open', '--start', '2026-10-19'])
  assert.equal(opened.after.id, '2026-10-19')
  assert.equal(opened.after.end, '2026-11-01')
  const moved = json(root, ['cycle', 'add', issue.id, '--to', '2026-10-19'])
  assert.equal(moved[0].after.sprint, '2026-10-19')
  const current = json(root, ['cycle', 'current'])
  assert.equal(current.id, '2026-10-19')
  assert.equal(current.state, 'active')
  const inSprint = json(root, ['cycle', 'issues', '2026-10-19'])
  assert.deepEqual(inSprint.map((i) => i.id), [issue.id])
  const none = json(root, ['cycle', 'add', issue.id, '--to', 'none'])
  assert.equal(none[0].after.sprint, undefined)
})

test('epic create, issues parent and epic progress', () => {
  const root = makeRepo('basic')
  const { after: epic } = json(root, ['epic', 'create', '--title', 'E'])
  const { after: issue } = json(root, ['issues', 'create', '--title', 'First'])
  json(root, ['issues', 'parent', issue.id, epic.id])
  const progress = json(root, ['epic', 'progress', epic.id])
  assert.equal(progress.total, 1)
  assert.equal(progress.done, 0)
  assert.match(run(root, ['epic', 'list']).stdout, new RegExp(`${epic.id}\\s+\\| E`))
})

test('epic update-status publishes the body from stdin', () => {
  const root = makeRepo('team')
  const result = run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'at_risk', '--body-file', '-'], { input: 'Late on retries.\n' })
  assert.equal(result.status, 0, result.stderr)
  const { after } = JSON.parse(run(root, ['epic', 'update-status', 'EPC-2M9D', '--health', 'on_track', '--body-file', '-', '--json'], { input: 'Back.\n' }).stdout)
  assert.equal(after.health, 'on_track')
  assert.equal(after.body, 'Back.')
})

test('metrics velocity on the team fixture', () => {
  const root = makeRepo('team')
  const result = json(root, ['metrics', 'velocity'])
  assert.deepEqual(result.perSprint, [{ id: '2026-09-28', points: 10, count: 3 }])
  assert.equal(result.average, 10)
  assert.equal(result.unit, 'points')
  assert.match(run(root, ['metrics', 'velocity']).stdout, /2026-09-28\s+\| 10\s+\| 3/)
})

test('metrics cycle-time summarizes done issues in range', () => {
  const root = makeRepo('team')
  const all = json(root, ['metrics', 'cycle-time'])
  assert.deepEqual([all.count, all.median, all.p85], [3, 7.3, 8])
  assert.deepEqual(all.issues.map((i) => i.issue).sort(), ['ISS-4P8A', 'ISS-7K3Q', 'ISS-9T2M'])
  assert.equal(json(root, ['metrics', 'cycle-time', '--until', '2026-10-08']).count, 3)
  assert.equal(json(root, ['metrics', 'cycle-time', '--until', '2026-10-07']).count, 2)
  const none = json(root, ['metrics', 'cycle-time', '--since', '2030-01-01'])
  assert.equal(none.count, 0)
  assert.equal(none.median, null)
})

test('events prints the events in a range', () => {
  const root = makeRepo('team')
  const events = json(root, ['events', '--since', '2026-10-01'])
  assert.ok(events.length > 0)
  assert.ok(events.every((event) => event.at >= '2026-10-01' && event.issue))
  assert.match(run(root, ['events', '--since', '2026-10-01']).stdout, /ISS-/)
})

test('validate on the broken fixture exits 0 and lists every problem', () => {
  const root = makeRepo('broken')
  const result = json(root, ['validate'])
  assert.ok(result.problems.length > 1)
  const text = run(root, ['validate'])
  assert.equal(text.status, 0)
  for (const problem of result.problems) {
    assert.ok(text.stdout.includes(problem.path), problem.path)
    assert.ok(text.stdout.includes(problem.code), problem.code)
    assert.ok(text.stdout.includes(problem.message), problem.message)
  }
})

test('capabilities --json lists 20 capabilities', () => {
  const root = makeRepo('basic')
  assert.equal(json(root, ['capabilities']).capabilities.length, 20)
  assert.match(run(root, ['capabilities']).stdout, /cycles/)
})

test('discover and whoami', () => {
  const root = makeRepo('team')
  assert.ok(json(root, ['discover']).statuses.length >= 7)
  assert.match(run(root, ['discover']).stdout, /in_progress/)
  assert.deepEqual(json(root, ['whoami']).id, 'fred')
  const none = run(root, ['whoami'], { env: { PMKIT_USER: null } })
  assert.equal(none.status, 2)
  assert.match(none.stderr, /^next: /m)
})

test('--help lists every command and exits 2', () => {
  const result = run(os.tmpdir(), ['--help'])
  assert.equal(result.status, 2)
  for (const name of [
    'init', 'capabilities', 'discover', 'whoami', 'issues list', 'issues get', 'issues create', 'issues update', 'issues move',
    'issues assign', 'issues link', 'issues parent', 'issues comment', 'issues log-time', 'issues archive',
    'cycle list', 'cycle current', 'cycle issues', 'cycle open', 'cycle close', 'cycle add', 'cycle capacity',
    'epic list', 'epic get', 'epic progress', 'epic create', 'epic update-status',
    'metrics velocity', 'metrics cycle-time', 'events', 'validate',
  ]) assert.ok(result.stdout.includes(name), name)
})

test('an unknown command prints usage and exits 2', () => {
  const result = run(os.tmpdir(), ['frobnicate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Usage:/)
})

test('an unknown flag is a usage error', () => {
  const root = makeRepo('basic')
  const result = run(root, ['issues', 'list', '--sortt', 'priority', '--json'])
  assert.equal(result.status, 2)
  assert.match(JSON.parse(result.stdout).error.message, /--sortt/)
  assert.equal(run(root, ['issues', 'list', '--dry-run']).status, 2)
})

test('criteria come from a file, --check ticks one and --uncheck clears it', () => {
  const root = makeRepo('basic')
  const created = JSON.parse(run(root, ['issues', 'create', '--title', 'C', '--criteria-file', '-', '--json'], { input: '- [ ] first\nsecond\n\n- [x] third\n' }).stdout)
  const id = created.after.id
  assert.deepEqual(created.after.acceptanceCriteria, [
    { text: 'first', done: false }, { text: 'second', done: false }, { text: 'third', done: true },
  ])
  const ticked = json(root, ['issues', 'update', id, '--check', '2'])
  assert.deepEqual(ticked.after.acceptanceCriteria.map((c) => c.done), [false, true, true])
  const cleared = json(root, ['issues', 'update', id, '--uncheck', '3'])
  assert.deepEqual(cleared.after.acceptanceCriteria.map((c) => c.done), [false, true, false])
  const bad = run(root, ['issues', 'update', id, '--check', '9'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /^error: /m)
})

test('description file, estimate and labels reach the issue', () => {
  const root = makeRepo('team')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-body-'))
  const file = path.join(dir, 'd.md')
  fs.writeFileSync(file, 'Line one\r\n\r\nLine two\r\n')
  const { after } = json(root, ['issues', 'create', '--title', 'T', '--estimate', '5', '--label', 'backend,billing', '--description-file', file, '--type', 'bug'])
  assert.equal(after.estimate, 5)
  assert.deepEqual(after.labels, ['backend', 'billing'])
  assert.equal(after.description, 'Line one\n\nLine two')
  const got = run(root, ['issues', 'get', after.id])
  assert.match(got.stdout, /estimate: 5/)
  assert.match(got.stdout, /Line two/)
})

test('assign, link, comment, log-time, archive and get --comments --history', () => {
  const root = makeRepo('team')
  assert.match(run(root, ['issues', 'assign', 'ISS-3F7H', 'ana']).stdout, /assignee: .* → ana/)
  json(root, ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'blocks'])
  assert.deepEqual(json(root, ['issues', 'get', 'ISS-4M2S']).blockedBy, ['ISS-3F7H'])
  json(root, ['issues', 'link', 'ISS-3F7H', 'ISS-4M2S', '--kind', 'blocks', '--remove'])
  assert.deepEqual(json(root, ['issues', 'get', 'ISS-4M2S']).blockedBy, [])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-body-'))
  const file = path.join(dir, 'c.md')
  fs.writeFileSync(file, 'Looks good.')
  assert.equal(run(root, ['issues', 'comment', 'ISS-3F7H', '--body-file', file]).status, 0)
  assert.equal(run(root, ['issues', 'log-time', 'ISS-3F7H', '45']).status, 0)
  assert.equal(run(root, ['issues', 'archive', 'ISS-3F7H']).status, 0)
  const got = json(root, ['issues', 'get', 'ISS-3F7H', '--comments', '--history'])
  assert.equal(got.comments.at(-1).body, 'Looks good.')
  assert.ok(got.history.some((event) => event.op === 'log_time' && event.minutes === 45))
  assert.equal(got.archived, true)
  const text = run(root, ['issues', 'get', 'ISS-3F7H', '--comments', '--history']).stdout
  assert.match(text, /Looks good\./)
  assert.match(text, /log_time/)
})

test('--as acts for another member and a stranger is rejected', () => {
  const root = makeRepo('team')
  json(root, ['issues', 'move', 'ISS-3F7H', 'done', '--as', 'ana'])
  const events = json(root, ['issues', 'get', 'ISS-3F7H', '--history']).history
  assert.equal(events.at(-1).by, 'ana')
  assert.equal(run(root, ['issues', 'move', 'ISS-3F7H', 'todo', '--as', 'nobody']).status, 2)
})

test('cycle capacity reads, and --set takes a list or repeated flags', () => {
  const root = makeRepo('team')
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12']), { fred: 8, ana: 10 })
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred=3,ana=4']).after.capacity, { fred: 3, ana: 4 })
  assert.deepEqual(json(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred=6', '--set', 'ana=7']).after.capacity, { fred: 6, ana: 7 })
  assert.equal(run(root, ['cycle', 'capacity', '2026-10-12', '--set', 'fred']).status, 2)
})

test('cycle close prints the unfinished issues', () => {
  const root = makeRepo('team')
  const result = json(root, ['cycle', 'close', '2026-10-12'])
  assert.equal(result.sprint.state, 'closed')
  assert.ok(Array.isArray(result.unfinished))
  assert.match(run(makeRepo('team'), ['cycle', 'close', '2026-10-12']).stdout, /state: active → closed/)
})

test('auto_commit commits only the tracker folder with pmkit: <op> <id>', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(root, 'other.txt'), 'x')
  git(root, 'add', 'other.txt')
  const { after } = json(root, ['issues', 'create', '--title', 'First'])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), `pmkit: issues create ${after.id}`)
  assert.ok(git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.includes(`.issues/issues/${after.id}/issue.md`))
  assert.ok(!git(root, 'show', '--name-only', '--format=', 'HEAD').stdout.includes('other.txt'))
  assert.equal(git(root, 'status', '--porcelain').stdout.trim(), 'A  other.txt')
  const dry = run(root, ['issues', 'move', after.id, 'todo', '--dry-run'])
  assert.equal(dry.status, 0)
  assert.equal(git(root, 'rev-list', '--count', 'HEAD').stdout.trim(), '2')
})

test('a failing auto_commit exits 2 with one JSON value that carries the result', () => {
  const root = makeRepo('basic')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'init')
  const hook = path.join(root, '.git/hooks/pre-commit')
  fs.writeFileSync(hook, '#!/bin/sh\necho rejected >&2\nexit 1\n', { mode: 0o755 })
  const result = run(root, ['issues', 'create', '--title', 'First', '--json'])
  assert.equal(result.status, 2)
  const body = JSON.parse(result.stdout)
  assert.equal(body.error.code, 'UPSTREAM')
  assert.ok(body.error.nextStep)
  assert.equal(body.result.after.title, 'First')
  assert.ok(fs.existsSync(path.join(root, '.issues/issues', body.result.after.id, 'issue.md')))
  const text = run(root, ['issues', 'create', '--title', 'Second'])
  assert.equal(text.status, 2)
  assert.match(text.stdout, /Second/)
  assert.match(text.stderr, /^error: .*auto_commit failed/m)
  assert.match(text.stderr, /^next: /m)
})
