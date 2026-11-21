// E2E test of docs/runbooks/cycles-epics-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH.
// The fake answers from a fixture file through answerGh (scripts/fake-github-api.mjs). Its `issues` key holds the state of the
// stateful fake GitHub (scripts/fake-github-issues.mjs), and the wrapper writes the fixture back after each call, so the state persists
// between CLI runs. The milestone create call goes through the REST route of answerGh. Every call is logged, and no logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { statefulGhOnPath } from './fake-gh-path.mjs'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { parseYaml } from './lib/yaml.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Zx9Q'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'cycles-epics-github.md')

const SETUP = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date', 'sprint=project:Sprint'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

/** The state the runbook's "Before you start" describes: a repository set up for GitHub, a Project with a Sprint field that holds
 * one iteration, and the epic Project acme/12 linked to the repository, which holds issue 4, a draft issue and a pull request.
 * Returns { root, fake, pmkit }. */
function runbookRepo() {
  const root = tempDir('pmkit-runbook-cycles-github-')
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  const iterations = { iterations: [{ id: 'IT_1', title: '2026-11-16', startDate: '2026-11-16', duration: 14 }] }
  const state = fakeGithubIssues({ project: { iterations }, epics: [{ number: 12, title: 'Search' }] })
  state.seed({ number: 1, title: 'Index the catalog' })
  state.seed({ number: 2, title: 'Add the search box' })
  state.seed({ number: 3, title: 'Rank the results' })
  // The sample epic holds the three kinds of Project item content (PMK-343): an issue, a draft issue and a pull request.
  state.seed({ number: 4, title: 'Tune the ranking', epics: ['acme/12'] })
  state.seedDraft({ project: 'PVT_acme_12', title: 'Try a fuzzy search' })
  state.seedProjectItem('acme/12', { type: 'PULL_REQUEST', title: 'Cache the index' })
  const fake = statefulGhOnPath({ meta: null, issues: state.toJSON() })
  const env = { ...childEnv(), ...userStoreEnv().env, GH_TOKEN: TOKEN, PMKIT_NOW: '2026-11-17T12:00:00Z', PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const pmkit = (...args) => {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  json(pmkit(...SETUP))
  fs.mkdirSync(path.join(root, 'tmp'))
  const files = {
    'title-epic.txt': 'Search\n',
    'update-1.md': 'Indexing is two days behind.\n',
    'update-2.md': 'Indexing caught up.\n',
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'tmp', name), text)
  return { root, fake, pmkit }
}

function json(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const failure = (result) => {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}
const calls = (fake) => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
const githubState = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8')).issues
const sprintField = (fake) => githubState(fake).project.fields.find((field) => field.name === 'Sprint')

function assertNoToken(fake) {
  const made = calls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
}

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of [
    'cycle list --json',
    'cycle current --json',
    'cycle open --start 2026-11-30 --json',
    'cycle open --start 2026-12-14 --goal "Ship search" --json',
    'cycle add 1 2 --to current --json',
    'cycle issues 2026-11-16 --json',
    'cycle add 2 --to 2026-11-30 --json',
    'cycle close 2026-11-16 --json',
    'epic create --title-file tmp/title-epic.txt --start 2026-11-17 --target 2026-12-15 --json',
    'epic list --json',
    'issues parent 3 acme/13 --json',
    'epic progress acme/13 --json',
    'epic get acme/12 --json',
    'epic progress acme/12 --json',
    'epic update-status acme/13 --health at_risk --body-file tmp/update-1.md --json',
    'epic update-status acme/13 --health on_track --body-file tmp/update-2.md --json',
    'epic updates acme/13 --json',
    'epic move acme/13 in_progress --json',
    'epic move acme/13 in_progress --status "At risk" --json',
    'epic move acme/13 done --dry-run --json',
    'epic move acme/13 done --json',
    'epic move acme/13 done --status Closed --json',
    'epic move acme/13 canceled --json',
    'warning: acme/13 still has open issues: 3',
    'a GitHub epic cannot move to canceled',
    'issues get acme/13 --json',
    'issue acme/13 does not exist',
    'milestone create v2 --due 2026-12-31 --json',
    'milestone create v1.0 --name "Version one" --json',
    'issues update 3 --milestone v2 --json',
    'milestone get v2 --json',
    'capabilities --json',
    'cycle capacity current --set octocat=5 --json',
    '.pmkit/capacity.yaml',
    'a GitHub iteration has no goal',
    'GitHub ends an iteration on its end date',
    'a GitHub milestone has one name, its title',
    'Add the iteration in the Project settings on GitHub',
  ]) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: sprints, epics and milestones on GitHub Issues, steps 1 to 20', () => {
  const { root, fake, pmkit } = runbookRepo()

  // Step 1: the sprint field is mapped, and the Project holds one sprint, which is active on 2026-11-17.
  const listed = json(pmkit('cycle', 'list', '--json'))
  assert.deepEqual(listed.map((sprint) => [sprint.id, sprint.name, sprint.start, sprint.end, sprint.state]), [['2026-11-16', '2026-11-16', '2026-11-16', '2026-11-29', 'active']])
  assert.equal(json(pmkit('cycle', 'current', '--json')).id, '2026-11-16')

  // Step 2: open a sprint. The existing iteration keeps its id.
  const opened = json(pmkit('cycle', 'open', '--start', '2026-11-30', '--json'))
  assert.equal(opened.before, null)
  assert.deepEqual([opened.after.id, opened.after.start, opened.after.end, opened.after.state], ['2026-11-30', '2026-11-30', '2026-12-13', 'planned'])
  const iterations = sprintField(fake).configuration.iterations
  assert.deepEqual(iterations.map((iteration) => iteration.startDate), ['2026-11-16', '2026-11-30'])
  assert.equal(iterations[0].id, 'IT_1')

  // Step 3: a sprint goal is refused.
  const goal = failure(pmkit('cycle', 'open', '--start', '2026-12-14', '--goal', 'Ship search', '--json'))
  assert.equal(goal.code, 'NOT_SUPPORTED')
  assert.match(goal.message, /a GitHub iteration has no goal/)
  assert.equal(sprintField(fake).configuration.iterations.length, 2)

  // Step 4: move two issues to the current sprint.
  const moved = json(pmkit('cycle', 'add', '1', '2', '--to', 'current', '--json'))
  assert.deepEqual(moved.map((entry) => entry.after.sprint), ['2026-11-16', '2026-11-16'])
  assert.deepEqual(json(pmkit('cycle', 'issues', '2026-11-16', '--json')).map((issue) => issue.id), ['1', '2'])

  // Step 5: move issue 2 to the next sprint.
  assert.equal(json(pmkit('cycle', 'add', '2', '--to', '2026-11-30', '--json'))[0].after.sprint, '2026-11-30')
  assert.deepEqual(json(pmkit('cycle', 'issues', '2026-11-16', '--json')).map((issue) => issue.id), ['1'])
  assert.deepEqual(json(pmkit('cycle', 'list', '--json')).map((sprint) => [sprint.id, sprint.state]), [['2026-11-16', 'active'], ['2026-11-30', 'planned']])

  // Step 6: closing a sprint is refused.
  const close = failure(pmkit('cycle', 'close', '2026-11-16', '--json'))
  assert.equal(close.code, 'NOT_SUPPORTED')
  assert.equal(close.message, 'GitHub ends an iteration on its end date')

  // Step 7: create an epic with dates. It is a new Project linked to the repository, and the sample Project took number 12.
  const epic = json(pmkit('epic', 'create', '--title-file', 'tmp/title-epic.txt', '--start', '2026-11-17', '--target', '2026-12-15', '--json'))
  assert.equal(epic.before, null)
  assert.deepEqual([epic.after.id, epic.after.title, epic.after.start, epic.after.target], ['acme/13', 'Search', '2026-11-17', '2026-12-15'])
  assert.deepEqual(json(pmkit('epic', 'list', '--json')).map((entry) => entry.id).sort(), ['acme/12', 'acme/13'])

  // Step 8: put issue 3 in the epic, then read the progress.
  const parent = json(pmkit('issues', 'parent', '3', 'acme/13', '--json'))
  assert.equal(parent.after.parent, 'acme/13')
  const progress = json(pmkit('epic', 'progress', 'acme/13', '--json'))
  assert.equal(progress.total, 1)
  assert.equal(progress.done, 0)
  // The sample epic acme/12 holds a draft issue and a pull request besides issue 4, and its progress counts the issue only.
  assert.equal(json(pmkit('epic', 'get', 'acme/12', '--json')).id, 'acme/12')
  const sample = json(pmkit('epic', 'progress', 'acme/12', '--json'))
  assert.deepEqual([sample.total, sample.done], [1, 0])

  // Step 9: publish two updates and list them, newest first. The third is the inactive update that epic create wrote to hold the dates,
  // and the dates stay on the epic after the new updates.
  json(pmkit('epic', 'update-status', 'acme/13', '--health', 'at_risk', '--body-file', 'tmp/update-1.md', '--json'))
  json(pmkit('epic', 'update-status', 'acme/13', '--health', 'on_track', '--body-file', 'tmp/update-2.md', '--json'))
  const updates = json(pmkit('epic', 'updates', 'acme/13', '--json'))
  assert.equal(updates.length, 3)
  assert.match(updates[0].body, /Indexing caught up/)
  assert.match(updates[1].body, /two days behind/)
  const after = json(pmkit('epic', 'get', 'acme/13', '--json'))
  assert.deepEqual([after.start, after.target], ['2026-11-17', '2026-12-15'])

  // Step 10: the epic is On track after step 9, so in_progress alone is refused, and another status of the category is a real move.
  // A move publishes a status update that carries the dates forward.
  const stay = failure(pmkit('epic', 'move', 'acme/13', 'in_progress', '--json'))
  assert.deepEqual([stay.code, stay.message], ['INVALID_INPUT', 'epic acme/13 is already in in_progress'])
  const risk = json(pmkit('epic', 'move', 'acme/13', 'in_progress', '--status', 'At risk', '--json'))
  assert.deepEqual([risk.before.status, risk.after.status], [{ name: 'On track', category: 'in_progress' }, { name: 'At risk', category: 'in_progress' }])
  const atRisk = json(pmkit('epic', 'get', 'acme/13', '--json'))
  assert.deepEqual([atRisk.status, atRisk.health, atRisk.start, atRisk.target], [{ name: 'At risk', category: 'in_progress' }, 'at_risk', '2026-11-17', '2026-12-15'])
  assert.equal(json(pmkit('epic', 'updates', 'acme/13', '--json'))[0].body, 'Status changed to At risk.')

  // Step 11: move to done. Issue 3 is still open, so both runs warn, and the dry run sends no mutation.
  const mutations = () => calls(fake).filter((call) => /\bmutation\b/.test(call.input)).length
  const mutationsBefore = mutations()
  const preview = pmkit('epic', 'move', 'acme/13', 'done', '--dry-run', '--json')
  assert.deepEqual(json(preview).after.status, { name: 'Complete', category: 'done' })
  assert.equal(preview.stderr, 'warning: acme/13 still has open issues: 3\n')
  assert.equal(mutations(), mutationsBefore, 'the dry run sent no mutation')
  const complete = pmkit('epic', 'move', 'acme/13', 'done', '--json')
  assert.deepEqual(json(complete).after.status, { name: 'Complete', category: 'done' })
  assert.equal(complete.stderr, 'warning: acme/13 still has open issues: 3\n')
  assert.ok(mutations() > mutationsBefore, 'the real run sent a mutation')
  const finished = json(pmkit('epic', 'get', 'acme/13', '--json'))
  assert.deepEqual(finished.status, { name: 'Complete', category: 'done' })
  assert.equal(finished.health, undefined)
  const completed = json(pmkit('epic', 'updates', 'acme/13', '--json'))
  assert.equal(completed[0].body, 'Status changed to Complete.')

  // Step 12: the other done status closes the Project and publishes no update.
  const closed = json(pmkit('epic', 'move', 'acme/13', 'done', '--status', 'Closed', '--json'))
  assert.deepEqual([closed.before.status.name, closed.after.status], ['Complete', { name: 'Closed', category: 'done' }])
  assert.deepEqual(json(pmkit('epic', 'get', 'acme/13', '--json')).status, { name: 'Closed', category: 'done' })
  assert.equal(json(pmkit('epic', 'updates', 'acme/13', '--json')).length, completed.length)

  // Step 13: a move out of done reopens the Project, then publishes the update.
  const reopened = json(pmkit('epic', 'move', 'acme/13', 'in_progress', '--json'))
  assert.deepEqual([reopened.before.status.name, reopened.after.status], ['Closed', { name: 'On track', category: 'in_progress' }])
  const back = json(pmkit('epic', 'get', 'acme/13', '--json'))
  assert.deepEqual([back.status, back.health], [{ name: 'On track', category: 'in_progress' }, 'on_track'])
  assert.equal(json(pmkit('epic', 'updates', 'acme/13', '--json'))[0].body, 'Status changed to On track.')

  // Step 14: a category that GitHub cannot store is refused, and nothing is written.
  const mutationsAfter = mutations()
  const refused = failure(pmkit('epic', 'move', 'acme/13', 'canceled', '--json'))
  assert.deepEqual([refused.code, refused.message, refused.nextStep], ['INVALID_INPUT', 'a GitHub epic cannot move to canceled', 'Use one of: backlog, in_progress, done'])
  assert.equal(mutations(), mutationsAfter)

  // Step 15: the calls of commands/issues/move.md for an epic ID. issues get does not find it, which is the fallback condition, and epic get does.
  const asIssue = failure(pmkit('issues', 'get', 'acme/13', '--json'))
  assert.deepEqual([asIssue.code, asIssue.message], ['NOT_FOUND', 'issue acme/13 does not exist'])
  assert.equal(json(pmkit('epic', 'get', 'acme/13', '--json')).id, 'acme/13')

  // Step 16: create a milestone. GitHub has no GraphQL mutation for it, so the call is a REST POST.
  const milestone = json(pmkit('milestone', 'create', 'v2', '--due', '2026-12-31', '--json'))
  assert.deepEqual(milestone.after, { id: 'v2', name: 'v2', due: '2026-12-31', status: 'open' })
  assert.ok(calls(fake).some((call) => call.args.includes('--method') && call.args.includes('POST') && call.args.includes('repos/acme/widgets/milestones')))

  // Step 17: a milestone name that differs from its id is refused, and no REST call follows.
  const before = calls(fake).length
  const named = failure(pmkit('milestone', 'create', 'v1.0', '--name', 'Version one', '--json'))
  assert.equal(named.code, 'INVALID_INPUT')
  assert.match(named.message, /a GitHub milestone has one name, its title/)
  assert.equal(calls(fake).slice(before).filter((call) => call.args.includes('POST')).length, 0)

  // Step 18: put issue 3 in the milestone, then read the milestone.
  assert.equal(json(pmkit('issues', 'update', '3', '--milestone', 'v2', '--json')).after.milestone, 'v2')
  assert.equal(json(pmkit('milestone', 'get', 'v2', '--json')).due, '2026-12-31')
  assert.deepEqual(githubState(fake).milestones.map((entry) => entry.title), ['v2'])

  // Step 19: the capabilities.
  const manifest = json(pmkit('capabilities', '--json'))
  const byId = Object.fromEntries(manifest.capabilities.map((entry) => [entry.id, entry]))
  assert.equal(byId.cycles.path, 'native')
  assert.deepEqual([byId.cycles.detail.field, byId.cycles.detail.open, byId.cycles.detail.close], ['Sprint', true, false])
  for (const id of ['capacity', 'deliverables', 'status_update']) assert.notEqual(byId[id].path, 'absent', id)

  // Step 20: set a capacity in the current sprint. GitHub has no capacity, so pmkit writes .pmkit/capacity.yaml under the Project key.
  const callsBefore = calls(fake).length
  const capacity = json(pmkit('cycle', 'capacity', 'current', '--set', 'octocat=5', '--json'))
  assert.deepEqual([capacity.before.capacity, capacity.after.id, capacity.after.capacity], [{}, '2026-11-16', { octocat: 5 }])
  const stored = parseYaml(fs.readFileSync(path.join(root, '.pmkit', 'capacity.yaml'), 'utf8'))
  assert.deepEqual(stored.cycles['github:acme/7']['2026-11-16'], { capacity: { octocat: 5 } })
  assert.equal(calls(fake).slice(callsBefore).filter((call) => /\bmutation\b/.test(call.input)).length, 0)

  assertNoToken(fake)
})
