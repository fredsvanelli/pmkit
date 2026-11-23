// E2E test of docs/runbooks/plans-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'plans-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher (a PMKIT_FAKE_NO_PLANS run sees a site with time tracking off) that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher() {
  const dir = tempDir('pmkit-jira-plans-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues({ ...(state ? { state } : {}), plans: !process.env.PMKIT_FAKE_NO_PLANS })
const routes = { ...fake.routes }
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
    'jira plans list',
    'jira plans list --json',
    'jira plans get 12',
    'jira plans get 12 --json',
    'jira plans get 99 --json',
    'jira plans list --limit 0 --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}\n`), command)
  assert.ok(text.includes('PMK-82') && text.includes('EPC-14') && text.includes('/pmkit:jira:plans-scenarios'))
  assert.ok(text.includes('Live check: skipped'))
})

test('the Jira plans flows, step by step', () => {
  const { pmkit } = session()

  // Step 1: capabilities.
  assert.equal(body(pmkit(['capabilities', '--json'])).tracker, 'jira')

  // Step 2: the plans.
  assert.equal(pmkit(['jira', 'plans', 'list']).stdout.trim(), '12  Q1 roadmap  (active)  scenario 34')
  const listed = body(pmkit(['jira', 'plans', 'list', '--json']))
  assert.equal(listed.available, true)
  assert.deepEqual(listed.plans.map((plan) => [plan.id, plan.name, plan.status, plan.scenario]), [['12', 'Q1 roadmap', 'active', { id: '34', default: true }]])
  assert.equal(listed.hasMore, false)

  // Step 3: the plan.
  const text = pmkit(['jira', 'plans', 'get', '12']).stdout
  for (const line of [
    'dependencies: sequential',
    "scenario: 34 (default; other scenarios are not readable through Jira's public API)",
    'release: Spring launch  versions 10001',
    'team: Payments  scrum  capacity 30 story points per sprint',
  ]) assert.ok(text.includes(line), line)
  const { plan } = body(pmkit(['jira', 'plans', 'get', '12', '--json']))
  assert.equal(plan.scheduling.dependencies, 'sequential')
  assert.deepEqual(plan.scenario, { id: '34', default: true })
  assert.deepEqual(plan.releases, [{ name: 'Spring launch', versionIds: [10001] }])
  assert.deepEqual(plan.teams.map((team) => [team.name, team.planningStyle, team.capacity, team.capacityUnit]), [['Payments', 'scrum', 30, 'story points per sprint']])

  // Step 4: an unknown plan.
  assert.equal(failure(pmkit(['jira', 'plans', 'get', '99', '--json'])).code, 'NOT_FOUND')

  // Step 5: a limit of zero.
  assert.equal(failure(pmkit(['jira', 'plans', 'list', '--limit', '0', '--json'])).code, 'INVALID_INPUT')

  // Step 6: a site without Jira Plans.
  const off = { PMKIT_FAKE_NO_PLANS: '1' }
  const hint = "Jira Plans need Jira Premium or Enterprise, and the token's owner needs the Administer Jira global permission"
  const offList = body(pmkit(['jira', 'plans', 'list', '--json'], off))
  assert.deepEqual([offList.available, offList.reason, offList.enableHint, offList.plans], [false, 'premium', hint, []])
  const offGet = body(pmkit(['jira', 'plans', 'get', '12', '--json'], off))
  assert.deepEqual([offGet.available, offGet.reason, offGet.enableHint], [false, 'premium', hint])
  for (const args of [['list'], ['get', '12']]) assert.equal(pmkit(['jira', 'plans', ...args], off).stdout.trim(), `Jira Plans are not available on acme.atlassian.net: ${hint}`)
})
