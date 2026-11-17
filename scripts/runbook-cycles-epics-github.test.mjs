// E2E test of docs/runbooks/cycles-epics-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH.
// The fake answers from a fixture file through answerGh (scripts/fake-github-api.mjs). Its `issues` key holds the state of the
// stateful fake GitHub (scripts/fake-github-issues.mjs), and the wrapper writes the fixture back after each call, so the state persists
// between CLI runs. The milestone create call goes through the REST route of answerGh. Every call is logged, and no logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Zx9Q'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'cycles-epics-github.md')

/** Writes the fake gh into a new folder and returns { bin, fixtureFile, log }. The fake saves the fixture after each call. */
function fakeGhOnPath(fixture) {
  const bin = tempDir('pmkit-fake-gh-')
  const fixtureFile = path.join(bin, 'fixture.json')
  const log = path.join(bin, 'calls.jsonl')
  fs.writeFileSync(fixtureFile, JSON.stringify(fixture))
  const api = pathToFileURL(path.join(SCRIPTS, 'fake-github-api.mjs')).href
  const script = `#!/usr/bin/env node
import fs from 'node:fs'
import { answerGh } from ${JSON.stringify(api)}
const args = process.argv.slice(2)
let input = ''
try { input = fs.readFileSync(0, 'utf8') } catch {}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n')
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixtureFile)}, 'utf8'))
const answer = answerGh(args, input, fixture)
fs.writeFileSync(${JSON.stringify(fixtureFile)}, JSON.stringify(fixture))
process.stdout.write(answer.stdout)
process.stderr.write(answer.stderr)
process.exitCode = answer.status
`
  fs.writeFileSync(path.join(bin, 'gh.mjs'), script)
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(bin, 'gh.mjs')}" "$@"\n`, { mode: 0o755 })
  return { bin, fixtureFile, log }
}

const SETUP = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date', 'sprint=project:Sprint'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

/** The state the runbook's "Before you start" describes: a repository set up for GitHub, a Project with a Sprint field that holds
 * one iteration, and the epic Project acme/12 linked to the repository. Returns { root, fake, pmkit }. */
function runbookRepo() {
  const root = tempDir('pmkit-runbook-cycles-github-')
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  const iterations = { iterations: [{ id: 'IT_1', title: '2026-11-16', startDate: '2026-11-16', duration: 14 }] }
  const state = fakeGithubIssues({ project: { iterations }, epics: [{ number: 12, title: 'Search' }] })
  state.seed({ number: 1, title: 'Index the catalog' })
  state.seed({ number: 2, title: 'Add the search box' })
  state.seed({ number: 3, title: 'Rank the results' })
  const fake = fakeGhOnPath({ meta: null, issues: state.toJSON() })
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
    'epic update-status acme/13 --health at_risk --body-file tmp/update-1.md --json',
    'epic update-status acme/13 --health on_track --body-file tmp/update-2.md --json',
    'epic updates acme/13 --json',
    'milestone create v2 --due 2026-12-31 --json',
    'milestone create v1.0 --name "Version one" --json',
    'issues update 3 --milestone v2 --json',
    'milestone get v2 --json',
    'capabilities --json',
    'a GitHub iteration has no goal',
    'GitHub ends an iteration on its end date',
    'a GitHub milestone has one name, its title',
    'Add the iteration in the Project settings on GitHub',
  ]) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: sprints, epics and milestones on GitHub Issues, steps 1 to 14', () => {
  const { fake, pmkit } = runbookRepo()

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

  // Step 10: create a milestone. GitHub has no GraphQL mutation for it, so the call is a REST POST.
  const milestone = json(pmkit('milestone', 'create', 'v2', '--due', '2026-12-31', '--json'))
  assert.deepEqual(milestone.after, { id: 'v2', name: 'v2', due: '2026-12-31', status: 'open' })
  assert.ok(calls(fake).some((call) => call.args.includes('--method') && call.args.includes('POST') && call.args.includes('repos/acme/widgets/milestones')))

  // Step 11: a milestone name that differs from its id is refused, and no REST call follows.
  const before = calls(fake).length
  const named = failure(pmkit('milestone', 'create', 'v1.0', '--name', 'Version one', '--json'))
  assert.equal(named.code, 'INVALID_INPUT')
  assert.match(named.message, /a GitHub milestone has one name, its title/)
  assert.equal(calls(fake).slice(before).filter((call) => call.args.includes('POST')).length, 0)

  // Step 12: put issue 3 in the milestone, then read the milestone.
  assert.equal(json(pmkit('issues', 'update', '3', '--milestone', 'v2', '--json')).after.milestone, 'v2')
  assert.equal(json(pmkit('milestone', 'get', 'v2', '--json')).due, '2026-12-31')
  assert.deepEqual(githubState(fake).milestones.map((entry) => entry.title), ['v2'])

  // Step 13: the capabilities.
  const manifest = json(pmkit('capabilities', '--json'))
  const byId = Object.fromEntries(manifest.capabilities.map((entry) => [entry.id, entry]))
  assert.equal(byId.cycles.path, 'native')
  assert.deepEqual([byId.cycles.detail.field, byId.cycles.detail.open, byId.cycles.detail.close], ['Sprint', true, false])
  for (const id of ['capacity', 'deliverables', 'status_update']) assert.notEqual(byId[id].path, 'absent', id)

  assertNoToken(fake)
})
