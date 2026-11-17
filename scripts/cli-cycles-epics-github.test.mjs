// The sprint, epic and milestone commands of the CLI over the GitHub adapter and the stateful fake GitHub, run in process.
// No test starts gh or opens a socket.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './pmkit.mjs'
import { ADAPTERS } from './lib/adapters.mjs'
import { githubDescriptor } from './lib/github/adapter.mjs'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

process.env.GIT_CONFIG_GLOBAL = os.devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CEILING_DIRECTORIES = fs.realpathSync(os.tmpdir())

const CONFIG = (host) => `version: 1
tracker:
  system: github
  scope:
    host: ${host}
    repo: acme/widgets
    project: acme/7
git_host:
  system: github
write_policy:
  confirm: none
mappings:
  status:
    backlog: Backlog
    todo: Todo
    in_progress: In Progress
    in_review: In Review
    done: Done
  fields:
    sprint: project:Sprint
`

const SPRINTS = { iterations: [{ id: 'IT_1', title: '2026-11-16', startDate: '2026-11-16', duration: 14 }] }

/** A git repository whose config names GitHub with a sprint field, a CLI runner over one fake GitHub, and today at 2026-11-17. */
function githubRepo({ host = 'github.com', ghesVersion = null, ...options } = {}) {
  const root = tempDir('pmkit-github-cycles-')
  spawnSync('git', ['init', '-q'], { cwd: root })
  fs.mkdirSync(path.join(root, '.pmkit'))
  fs.writeFileSync(path.join(root, '.pmkit', 'config.yaml'), CONFIG(host))
  const fake = fakeGithubIssues({ host, ghesVersion, project: { iterations: SPRINTS }, epics: [{ number: 12, title: 'Epic twelve' }], ...options })
  fake.seed({ number: 1, title: 'One' })
  fake.seed({ number: 2, title: 'Two' })
  const env = { ...childEnv(), ...userStoreEnv().env, PMKIT_NOW: '2026-11-17T12:00:00Z' }
  const adapters = { ...ADAPTERS, github: githubDescriptor({ exec: fake.exec }) }
  const cli = (args) => run(args, { cwd: root, env, adapters })
  return { root, fake, cli }
}

const dataOf = (result) => {
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => {
  assert.notEqual(result.code, 0, result.stdout)
  return JSON.parse(result.stdout).error
}

test('cycle list and cycle current read the iterations of the sprint field', async () => {
  const { cli } = githubRepo()
  const listed = dataOf(await cli(['cycle', 'list', '--json']))
  assert.deepEqual(listed.map((sprint) => [sprint.id, sprint.start, sprint.end, sprint.state]), [['2026-11-16', '2026-11-16', '2026-11-29', 'active']])
  assert.equal(dataOf(await cli(['cycle', 'current', '--json'])).id, '2026-11-16')
})

test('cycle list warns about two iterations on one start date, and keeps the warning out of the JSON', async () => {
  const twice = { iterations: [{ id: 'IT_1', title: 'First', startDate: '2026-11-16', duration: 14 }, { id: 'IT_2', title: 'Second', startDate: '2026-11-16', duration: 7 }] }
  const { cli } = githubRepo({ project: { iterations: twice } })
  const result = await cli(['cycle', 'list', '--json'])
  assert.deepEqual(dataOf(result).map((sprint) => [sprint.id, sprint.name]), [['2026-11-16', 'First']])
  assert.match(result.stderr, /^warning: two iterations start on 2026-11-16; pmkit shows the first$/m)
})

test('cycle open adds an iteration on github.com and refuses on GitHub Enterprise Server', async () => {
  const { cli } = githubRepo()
  const opened = dataOf(await cli(['cycle', 'open', '--start', '2026-11-30', '--json']))
  assert.equal(opened.before, null)
  assert.deepEqual([opened.after.id, opened.after.end, opened.after.state], ['2026-11-30', '2026-12-13', 'planned'])
  assert.deepEqual(dataOf(await cli(['cycle', 'list', '--json'])).map((sprint) => sprint.id), ['2026-11-16', '2026-11-30'])
  const ghes = githubRepo({ host: 'ghes.example.com', ghesVersion: '3.19.0' })
  const refused = errorOf(await ghes.cli(['cycle', 'open', '--start', '2026-11-30', '--json']))
  assert.equal(refused.code, 'NOT_SUPPORTED')
  assert.match(refused.nextStep, /Add the iteration in the Project settings on GitHub/)
})

test('cycle close answers NOT_SUPPORTED, because GitHub ends an iteration on its end date', async () => {
  const { cli } = githubRepo()
  const refused = errorOf(await cli(['cycle', 'close', '2026-11-16', '--json']))
  assert.equal(refused.code, 'NOT_SUPPORTED')
  assert.equal(refused.message, 'GitHub ends an iteration on its end date')
})

test('cycle open --goal answers NOT_SUPPORTED, because a GitHub iteration has no goal', async () => {
  const { cli } = githubRepo()
  const refused = errorOf(await cli(['cycle', 'open', '--start', '2026-11-30', '--goal', 'Ship search', '--json']))
  assert.equal(refused.code, 'NOT_SUPPORTED')
  assert.match(refused.message, /a GitHub iteration has no goal/)
})

test('cycle add moves an issue into the current sprint and out of it, and cycle issues lists it', async () => {
  const { cli } = githubRepo()
  const moved = dataOf(await cli(['cycle', 'add', '1', '--to', 'current', '--json']))
  assert.equal(moved[0].after.sprint, '2026-11-16')
  assert.deepEqual(dataOf(await cli(['cycle', 'issues', '2026-11-16', '--json'])).map((issue) => issue.id), ['1'])
  const cleared = dataOf(await cli(['cycle', 'add', '1', '--to', 'none', '--json']))
  assert.equal(cleared[0].after.sprint, undefined)
  assert.deepEqual(dataOf(await cli(['cycle', 'issues', '2026-11-16', '--json'])), [])
})

test('milestone create sends a REST call with the due date, and milestone list and get read it back', async () => {
  const { fake, cli } = githubRepo()
  assert.deepEqual(dataOf(await cli(['milestone', 'list', '--json'])), [])
  const created = dataOf(await cli(['milestone', 'create', 'v2', '--due', '2026-12-31', '--json']))
  assert.deepEqual(created.after, { id: 'v2', name: 'v2', due: '2026-12-31', status: 'open' })
  assert.deepEqual(fake.mutations.filter((call) => call.name === 'RestCreateMilestone').map((call) => call.input.title), ['v2'])
  assert.deepEqual(dataOf(await cli(['milestone', 'list', '--json'])).map((milestone) => milestone.id), ['v2'])
  assert.equal(dataOf(await cli(['milestone', 'get', 'v2', '--json'])).due, '2026-12-31')
})

test('milestone create with a name that differs from its id answers INVALID_INPUT and makes no REST call', async () => {
  const { fake, cli } = githubRepo()
  const refused = errorOf(await cli(['milestone', 'create', 'v1.0', '--name', 'Version one', '--json']))
  assert.equal(refused.code, 'INVALID_INPUT')
  assert.match(refused.message, /a GitHub milestone has one name, its title/)
  assert.equal(fake.mutations.filter((call) => call.name === 'RestCreateMilestone').length, 0)
})

test('epic create, list and get work on linked Projects, with the dates of the Project', async () => {
  const { cli } = githubRepo()
  const created = dataOf(await cli(['epic', 'create', '--title', 'Search', '--start', '2026-11-17', '--target', '2026-12-15', '--json']))
  assert.equal(created.before, null)
  assert.deepEqual([created.after.id, created.after.title, created.after.start, created.after.target], ['acme/13', 'Search', '2026-11-17', '2026-12-15'])
  assert.deepEqual(dataOf(await cli(['epic', 'list', '--json'])).map((epic) => epic.id).sort(), ['acme/12', 'acme/13'])
  assert.equal(dataOf(await cli(['epic', 'get', 'acme/12', '--json'])).title, 'Epic twelve')
})

test('epic create --goal answers NOT_SUPPORTED', async () => {
  const { cli } = githubRepo()
  const refused = errorOf(await cli(['epic', 'create', '--title', 'Search', '--goal', 'g1', '--json']))
  assert.equal(refused.code, 'NOT_SUPPORTED')
})

test('epic update-status publishes an update and epic updates lists it, newest first', async () => {
  const { root, cli } = githubRepo()
  fs.writeFileSync(path.join(root, 'update.md'), 'Two weeks behind on search indexing.\n')
  dataOf(await cli(['epic', 'update-status', 'acme/12', '--health', 'at_risk', '--body-file', path.join(root, 'update.md'), '--json']))
  fs.writeFileSync(path.join(root, 'update2.md'), 'Back on track.\n')
  dataOf(await cli(['epic', 'update-status', 'acme/12', '--health', 'on_track', '--body-file', path.join(root, 'update2.md'), '--json']))
  const updates = dataOf(await cli(['epic', 'updates', 'acme/12', '--json']))
  assert.equal(updates.length, 2)
  assert.match(updates[0].body, /Back on track/)
  assert.match(updates[1].body, /behind on search indexing/)
})

test('issues parent puts an issue in an epic, and epic progress counts it', async () => {
  const { cli } = githubRepo()
  assert.equal(dataOf(await cli(['issues', 'parent', '1', 'acme/12', '--json'])).after.parent, 'acme/12')
  assert.equal(dataOf(await cli(['epic', 'progress', 'acme/12', '--json'])).total, 1)
  assert.equal(dataOf(await cli(['issues', 'parent', '1', 'none', '--json'])).after.parent, undefined)
  assert.equal(dataOf(await cli(['epic', 'progress', 'acme/12', '--json'])).total, 0)
})

test('issues parent none on an issue with a parent issue and an epic item removes the parent issue and notes the epic left', async () => {
  const { fake, cli } = githubRepo()
  fake.seed({ number: 3, title: 'Three', parent: 1, epics: ['acme/12'] })
  const result = await cli(['issues', 'parent', '3', 'none', '--json'])
  const data = dataOf(result)
  assert.equal(data.before.parent, '1')
  assert.equal(data.after.parent, 'acme/12')
  assert.match(result.stderr, /^note: 3 still belongs to epic acme\/12; run pmkit issues parent 3 none again to remove it$/m)
  const again = await cli(['issues', 'parent', '3', 'none', '--json'])
  assert.equal(dataOf(again).after.parent, undefined)
  assert.doesNotMatch(again.stderr, /still belongs to epic/)
})

test('issues update --milestone puts an issue in a milestone', async () => {
  const { cli } = githubRepo()
  dataOf(await cli(['milestone', 'create', 'v2', '--json']))
  assert.equal(dataOf(await cli(['issues', 'update', '2', '--milestone', 'v2', '--json'])).after.milestone, 'v2')
})

test('capabilities reports cycles, capacity, deliverables and status_update', async () => {
  const { cli } = githubRepo()
  const manifest = dataOf(await cli(['capabilities', '--json']))
  const byId = Object.fromEntries(manifest.capabilities.map((entry) => [entry.id, entry]))
  assert.equal(byId.cycles.path, 'native')
  assert.deepEqual([byId.cycles.detail.open, byId.cycles.detail.close], [true, false])
  for (const id of ['capacity', 'deliverables', 'status_update']) assert.notEqual(byId[id].path, 'absent', id)
})
