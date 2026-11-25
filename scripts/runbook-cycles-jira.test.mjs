// E2E test of docs/runbooks/cycles-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
// (scripts/fake-jira-issues.mjs) before the CLI loads, so no socket opens. The launcher keeps the fake's state in a JSON file beside it
// and writes it back after each run, so the work items persist from one step to the next.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { childEnv } from './golden-helpers.mjs'
import { FAKE_EMAIL, FAKE_ENV, FAKE_HEADER, FAKE_TOKEN } from './fake-jira-api.mjs'
import { makeRepo, tempDir } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'cycles-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher (a PMKIT_FAKE_KANBAN_ONLY run sees a space whose only board is Kanban; a PMKIT_FAKE_TEAM_FEATURES run sees a team-managed space whose one board is simple, with the comma-separated features on) that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher() {
  const dir = tempDir('pmkit-jira-cycles-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues(state ? { state } : {})
const routes = { ...fake.routes }
if (process.env.PMKIT_FAKE_KANBAN_ONLY) routes['GET /rest/agile/1.0/board'] = { json: { startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: 2, name: 'ENG kanban', type: 'kanban' }] } }
const team = process.env.PMKIT_FAKE_TEAM_FEATURES
if (team !== undefined) {
  const on = new Set(team.split(',').filter(Boolean))
  routes['GET /rest/api/3/project/ENG'] = { json: { ...routes['GET /rest/api/3/project/ENG'].json, style: 'next-gen', simplified: true } }
  routes['GET /rest/agile/1.0/board'] = { json: { startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: 1, name: 'ENG board', type: 'simple' }] } }
  routes['GET /rest/agile/1.0/board/1/features'] = { json: { features: ['sprints', 'estimation', 'releases'].map((key) => ({ boardId: 1, feature: 'jsw.agility.' + key, state: on.has(key) ? 'ENABLED' : 'DISABLED' })) } }
}
globalThis.fetch = fakeJiraFetch(routes)
const { run } = await import(${JSON.stringify(url('pmkit.mjs'))})
const result = await run(process.argv.slice(2))
fs.writeFileSync(stateFile, JSON.stringify(fake.state))
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.code
`)
  return file
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd, encoding: 'utf8', env: childEnv() })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** The repository the runbook's "Before you start" describes: Jira site and space, and the types mapped. */
function jiraRepo() {
  const root = makeRepo('basic')
  const file = path.join(root, '.pmkit', 'config.yaml')
  const text = fs.readFileSync(file, 'utf8').replace(/^ {2}system: local$/m, '  system: jira\n  scope:\n    site: acme.atlassian.net\n    space: ENG')
  fs.writeFileSync(file, `${text.replace(/^git_host:\n {2}system: none$/m, 'git_host:\n  system: github\n  repo: acme/widgets\n  default_branch: main')}mappings:\n  types:\n    feature: Story\n    bug: Bug\n  fields:\n    sprint: customfield_10020\n`)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'init')
  fs.mkdirSync(path.join(root, 'tmp'))
  return root
}

function session() {
  const root = jiraRepo()
  const launch = launcher()
  const pmkit = (args, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [launch, ...args], { cwd: root, env: { ...childEnv(), ...FAKE_ENV, PMKIT_NOW: '2026-11-22T12:00:00Z', ...extraEnv }, encoding: 'utf8' })
    const out = `${result.stdout}${result.stderr}`
    for (const secret of [FAKE_TOKEN, FAKE_EMAIL, FAKE_HEADER, FAKE_HEADER.slice(6)]) assert.ok(!out.includes(secret), 'a credential reached the output')
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  const write = (name, text) => fs.writeFileSync(path.join(root, 'tmp', name), text)
  return { pmkit, write, root }
}

const body = (result) => {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  const parsed = JSON.parse(result.stdout)
  return parsed.data ?? parsed
}

test('the runbook names every command the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  const commands = [
    'capabilities --json',
    'cycle open --start 2026-11-22 --goal "Ship sprints" --dry-run --json',
    'cycle open --start 2026-11-22 --goal "Ship sprints" --json',
    'cycle open --start 2026-12-07 --json',
    'cycle list --json',
    'issues create --title-file tmp/title-1.txt --type feature --json',
    'issues create --title-file tmp/title-2.txt --type feature --json',
    'cycle add ENG-1 ENG-2 --to 1 --json',
    'issues list --sprint current --json',
    'cycle capacity 1 --set acc-1=8 --json',
    'issues move ENG-2 done --field resolution=Done --json',
    'cycle close 1 --dry-run --json',
    'cycle close 1 --json',
    'issues list --sprint none --json',
    'issues get ENG-2 --json',
    'issues move ENG-2 done --json',
    'cycle list --json',
    'cycle open --start 2026-11-22 --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}`), command)
  assert.ok(text.includes('PMK-370'))
})

test('the sprint flows, step by step', () => {
  const { pmkit, write, root } = session()
  write('title-1.txt', 'Plan the sprint')
  write('title-2.txt', 'Ship the sprint')

  // Capabilities
  const capabilities = body(pmkit(['capabilities', '--json'])).capabilities
  assert.equal(capabilities.find((entry) => entry.id === 'cycles').path, 'native')
  assert.equal(capabilities.find((entry) => entry.id === 'capacity').path, 'derived')

  // Open: a dry run, the active sprint, a planned one
  const dry = body(pmkit(['cycle', 'open', '--start', '2026-11-22', '--goal', 'Ship sprints', '--dry-run', '--json']))
  assert.equal(dry.after.id, null)
  assert.equal(dry.after.state, 'active')
  assert.deepEqual(body(pmkit(['cycle', 'list', '--json'])), [])
  const active = body(pmkit(['cycle', 'open', '--start', '2026-11-22', '--goal', 'Ship sprints', '--json']))
  assert.equal(active.before, null)
  assert.deepEqual(active.after, { id: '1', name: 'Sprint 2026-11-22', start: '2026-11-22', end: '2026-12-05', goal: 'Ship sprints', state: 'active', capacity: {}, daysOff: {} })
  const planned = body(pmkit(['cycle', 'open', '--start', '2026-12-07', '--json']))
  assert.equal(planned.after.id, '2')
  assert.equal(planned.after.state, 'planned')
  assert.equal(planned.after.end, '2026-12-20')
  const listed = body(pmkit(['cycle', 'list', '--json']))
  assert.deepEqual(listed.map((sprint) => [sprint.id, sprint.state]), [['1', 'active'], ['2', 'planned']])

  // Add work items to the active sprint
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'feature', '--json'])).after.id, 'ENG-1')
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-2.txt', '--type', 'feature', '--json'])).after.id, 'ENG-2')
  const added = body(pmkit(['cycle', 'add', 'ENG-1', 'ENG-2', '--to', '1', '--json']))
  assert.deepEqual(added.map((change) => [change.after.id, change.after.sprint]), [['ENG-1', '1'], ['ENG-2', '1']])
  const current = body(pmkit(['issues', 'list', '--sprint', 'current', '--json']))
  assert.deepEqual(current.issues.map((issue) => issue.id), ['ENG-1', 'ENG-2'])

  // Capacity lands in .pmkit/capacity.yaml, not in Jira
  const capacity = body(pmkit(['cycle', 'capacity', '1', '--set', 'acc-1=8', '--json']))
  assert.deepEqual(capacity.after.capacity, { 'acc-1': 8 })
  assert.match(fs.readFileSync(path.join(root, '.pmkit', 'capacity.yaml'), 'utf8'), /jira:acme\.atlassian\.net\/1/)

  // Close: ENG-2 is done, ENG-1 is not
  const refused = pmkit(['issues', 'move', 'ENG-2', 'done', '--json'])
  assert.equal(refused.code, 2, refused.stdout)
  assert.equal(JSON.parse(refused.stdout).error.code, 'INVALID_INPUT')
  const moved = body(pmkit(['issues', 'move', 'ENG-2', 'done', '--field', 'resolution=Done', '--json']))
  assert.equal(moved.after.status.category, 'done')
  const closeDry = body(pmkit(['cycle', 'close', '1', '--dry-run', '--json']))
  assert.equal(closeDry.sprint.state, 'closed')
  assert.deepEqual(closeDry.unfinished.map((issue) => issue.id), ['ENG-1'])
  assert.equal(body(pmkit(['cycle', 'list', '--json']))[0].state, 'active')
  const closed = body(pmkit(['cycle', 'close', '1', '--json']))
  assert.equal(closed.sprint.state, 'closed')
  assert.deepEqual(closed.sprint.capacity, { 'acc-1': 8 })
  assert.deepEqual(closed.unfinished.map((issue) => issue.id), ['ENG-1'])
  assert.deepEqual(closed.problems, [])

  // After the close: ENG-1 has no sprint, ENG-2 keeps the closed one
  const none = body(pmkit(['issues', 'list', '--sprint', 'none', '--json']))
  assert.deepEqual(none.issues.map((issue) => issue.id), ['ENG-1'])
  assert.equal(body(pmkit(['issues', 'get', 'ENG-2', '--json'])).sprint, '1')
  assert.equal(body(pmkit(['issues', 'get', 'ENG-1', '--json'])).sprint, undefined)
})

test('a space with only a Kanban board has no sprints', () => {
  const { pmkit } = session()
  const result = pmkit(['cycle', 'list', '--json'], { PMKIT_FAKE_KANBAN_ONLY: '1' })
  assert.equal(result.code, 2, result.stdout)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_SUPPORTED')
  assert.equal(error.nextStep, 'Sprints need a Scrum board in space ENG')
})

// PMK-393: a team-managed space's one board stays simple; its Sprints feature makes it the sprint board.
test('a team-managed space with Sprints on runs sprints on its simple board', () => {
  const { pmkit } = session()
  const env = { PMKIT_FAKE_TEAM_FEATURES: 'sprints,estimation' }
  const capabilities = body(pmkit(['capabilities', '--json'], env)).capabilities
  const entry = (id) => capabilities.find((item) => item.id === id)
  assert.equal(entry('cycles').path, 'native')
  assert.deepEqual(entry('releases'), { id: 'releases', path: 'absent', enableHint: "Turn on Releases in space ENG's features" })
  assert.deepEqual(body(pmkit(['cycle', 'list', '--json'], env)), [])
  const opened = body(pmkit(['cycle', 'open', '--start', '2026-11-22', '--json'], env))
  assert.equal(opened.after.state, 'active')
  assert.equal(body(pmkit(['cycle', 'list', '--json'], env)).length, 1)
})

test('a team-managed space with Sprints off names the Sprints feature', () => {
  const { pmkit } = session()
  const result = pmkit(['cycle', 'list', '--json'], { PMKIT_FAKE_TEAM_FEATURES: 'estimation' })
  assert.equal(result.code, 2, result.stdout)
  const { error } = JSON.parse(result.stdout)
  assert.equal(error.code, 'NOT_SUPPORTED')
  assert.equal(error.nextStep, "Turn on Sprints in space ENG's features")
})
