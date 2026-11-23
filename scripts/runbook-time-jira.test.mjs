// E2E test of docs/runbooks/time-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'time-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher (a PMKIT_FAKE_NO_TIME run sees a site with time tracking off) that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher() {
  const dir = tempDir('pmkit-jira-time-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues(state ? { state } : {})
const routes = { ...fake.routes }
if (process.env.PMKIT_FAKE_NO_TIME) routes['GET /rest/api/3/configuration'] = { json: { issueLinkingEnabled: true, timeTrackingEnabled: false } }
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
  fs.writeFileSync(file, `${text.replace(/^git_host:\n {2}system: none$/m, 'git_host:\n  system: github\n  repo: acme/widgets\n  default_branch: main')}mappings:\n  types:\n    feature: Story\n    bug: Bug\n`)
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
const failure = (result) => {
  assert.equal(result.code, 2, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout).error
}

test('the runbook names every command the test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  const commands = [
    'capabilities --json',
    'issues create --title-file tmp/title-1.txt --type feature --json',
    'issues log-time ENG-1 1h30 --dry-run --json',
    'issues log-time ENG-1 1h30 --json',
    'issues log-time ENG-1 45m --json',
    'issues time-entries ENG-1 --json',
    'issues get ENG-1 --history --json',
    'issues log-time ENG-1 0 --json',
    'discover --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}`), command)
  assert.ok(text.includes('PMK-378'))
})

test('the time tracking flows, step by step', () => {
  const { pmkit, write } = session()
  write('title-1.txt', 'Send the first invoice')
  const timeTracking = (result) => body(result).capabilities.find((entry) => entry.id === 'time_tracking')

  // Step 1: capabilities.
  assert.deepEqual(timeTracking(pmkit(['capabilities', '--json'])), { id: 'time_tracking', path: 'native' })

  // Step 2: a work item.
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'feature', '--json'])).after.id, 'ENG-1')

  // Step 3: a dry run, then two entries.
  assert.equal(body(pmkit(['issues', 'log-time', 'ENG-1', '1h30', '--dry-run', '--json'])).minutes, 90)
  assert.deepEqual(body(pmkit(['issues', 'time-entries', 'ENG-1', '--json'])).entries, [])
  assert.equal(body(pmkit(['issues', 'log-time', 'ENG-1', '1h30', '--json'])).minutes, 90)
  assert.equal(body(pmkit(['issues', 'log-time', 'ENG-1', '45m', '--json'])).minutes, 45)

  // Step 4: the entries and totals.
  const listed = body(pmkit(['issues', 'time-entries', 'ENG-1', '--json']))
  assert.deepEqual(listed.entries, [
    { at: '2026-11-22T12:00:00.000Z', by: 'acc-1', minutes: 90, time: '1h30' },
    { at: '2026-11-22T12:00:00.000Z', by: 'acc-1', minutes: 45, time: '45m' },
  ])
  assert.deepEqual([listed.total, listed.totalTime, listed.ignored], [135, '2h15', 0])
  assert.deepEqual(listed.byPerson, [{ by: 'acc-1', minutes: 135, time: '2h15' }])
  assert.deepEqual(listed.bySprint, [{ sprint: null, minutes: 135, time: '2h15' }])

  // Step 5: the history.
  const history = body(pmkit(['issues', 'get', 'ENG-1', '--history', '--json'])).history
  assert.deepEqual(history.filter((event) => event.op === 'log_time').map((event) => event.minutes), [90, 45])
  assert.ok(!history.some((event) => String(event.field).startsWith('jira:timespent')))

  // Step 6: a time of zero.
  assert.equal(failure(pmkit(['issues', 'log-time', 'ENG-1', '0', '--json'])).code, 'INVALID_INPUT')

  // Step 7: time tracking off.
  const off = { PMKIT_FAKE_NO_TIME: '1' }
  const hint = "Turn on time tracking in Jira's global settings"
  body(pmkit(['discover', '--json'], off))
  for (const args of [['issues', 'log-time', 'ENG-1', '1h30', '--json'], ['issues', 'time-entries', 'ENG-1', '--json']]) {
    const error = failure(pmkit(args, off))
    assert.deepEqual([error.code, error.message], ['NOT_SUPPORTED', hint])
  }
  assert.deepEqual(timeTracking(pmkit(['capabilities', '--json'], off)), { id: 'time_tracking', path: 'absent', enableHint: hint })
})
