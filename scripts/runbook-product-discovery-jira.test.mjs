// E2E test of docs/runbooks/product-discovery-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'product-discovery-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher (a PMKIT_FAKE_NO_DISCOVERY run sees a site without a Jira Product Discovery project) that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher() {
  const dir = tempDir('pmkit-jira-ideas-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues({ ...(state ? { state } : {}), discovery: !process.env.PMKIT_FAKE_NO_DISCOVERY })
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
    const result = spawnSync(process.execPath, [launch, ...args], { cwd: root, env: { ...childEnv(), ...FAKE_ENV, PMKIT_NOW: '2026-11-23T12:00:00Z', ...extraEnv }, encoding: 'utf8' })
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
    'jira ideas list',
    'jira ideas list --json',
    'jira ideas list --project IDEA --json',
    'jira ideas list --project idea --json',
    'jira ideas list --limit 1 --json',
    'epic create --title-file tmp/epic.txt --json',
    'jira ideas connect IDEA-1 ENG-1 --dry-run --json',
    'jira ideas connect IDEA-1 ENG-1',
    'jira ideas connect IDEA-1 ENG-1 --json',
    'jira ideas connect ENG-1 IDEA-1 --json',
    'jira ideas list --limit abc --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}\n`), command)
  assert.ok(text.includes('PMK-83') && text.includes('EPC-14') && text.includes('/pmkit:jira:product-discovery'))
  assert.ok(text.includes('Live check: skipped (no Jira credentials), see EPC-14'))
})

test('the Jira Product Discovery flows, step by step', () => {
  const { pmkit, write } = session()
  const insights = "Jira's REST API does not return Jira Product Discovery insights, so insights are unread"

  // Step 1: capabilities.
  assert.equal(body(pmkit(['capabilities', '--json'])).tracker, 'jira')

  // Step 2: the ideas, newest first, insights unread.
  const text = pmkit(['jira', 'ideas', 'list'])
  assert.equal(text.stdout.trim(), [
    'IDEA-2  Dark mode  (Discovery)  votes unread  insights unread  delivery none',
    'IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery none',
  ].join('\n'))
  assert.ok(text.stderr.includes(`warning: ${insights}`))
  const listed = body(pmkit(['jira', 'ideas', 'list', '--json']))
  assert.equal(listed.available, true)
  assert.deepEqual(listed.project, { key: 'IDEA', name: 'Ideas' })
  assert.deepEqual(listed.ideas.map((idea) => [idea.id, idea.votes, idea.insights, idea.epics]), [
    ['IDEA-2', [{ field: 'Votes', value: null }], null, []],
    ['IDEA-1', [{ field: 'Votes', value: 7 }], null, []],
  ])
  assert.equal(listed.hasMore, false)
  assert.ok(listed.warnings.includes(insights))
  assert.ok(listed.warnings.includes('Jira did not return the votes of 1 ideas'))

  // Step 3: one project named, in any case, and a cut list.
  for (const key of ['IDEA', 'idea']) assert.deepEqual(body(pmkit(['jira', 'ideas', 'list', '--project', key, '--json'])).ideas.map((idea) => idea.id), ['IDEA-2', 'IDEA-1'], key)
  const cut = body(pmkit(['jira', 'ideas', 'list', '--limit', '1', '--json']))
  assert.deepEqual([cut.ideas.map((idea) => idea.id), cut.hasMore], [['IDEA-2'], true])

  // Step 4: an epic in the space.
  write('epic.txt', 'Exports\n')
  assert.equal(body(pmkit(['epic', 'create', '--title-file', 'tmp/epic.txt', '--json'])).after.id, 'ENG-1')

  // Step 5: preview the connection.
  const preview = body(pmkit(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1', '--dry-run', '--json']))
  assert.deepEqual(preview, { idea: 'IDEA-1', epic: 'ENG-1', linkType: 'Polaris work item link', before: { epics: [] }, after: { epics: ['ENG-1'] } })
  assert.deepEqual(body(pmkit(['jira', 'ideas', 'list', '--json'])).ideas.find((idea) => idea.id === 'IDEA-1').epics, [], 'the dry run writes nothing')

  // Step 6: connect, then read the delivery back.
  assert.equal(pmkit(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1']).stdout.trim(), 'connected IDEA-1 to ENG-1')
  assert.ok(pmkit(['jira', 'ideas', 'list']).stdout.includes('IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery ENG-1'))

  // Step 7: connecting again changes nothing.
  const again = body(pmkit(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1', '--json']))
  assert.deepEqual([again.before, again.after], [{ epics: ['ENG-1'] }, { epics: ['ENG-1'] }])
  assert.equal(pmkit(['jira', 'ideas', 'connect', 'IDEA-1', 'ENG-1']).stdout.trim(), 'IDEA-1 is already connected to ENG-1')
  assert.deepEqual(body(pmkit(['jira', 'ideas', 'list', '--json'])).ideas.find((idea) => idea.id === 'IDEA-1').epics, ['ENG-1'])

  // Step 8: the arguments swapped.
  const swapped = failure(pmkit(['jira', 'ideas', 'connect', 'ENG-1', 'IDEA-1', '--json']))
  assert.deepEqual([swapped.code, swapped.message], ['NOT_FOUND', 'ENG-1 is not an idea of a Jira Product Discovery project on acme.atlassian.net'])

  // Step 9: a limit that is not a number.
  const usage = failure(pmkit(['jira', 'ideas', 'list', '--limit', 'abc', '--json']))
  assert.deepEqual([usage.code, usage.message], ['INVALID_INPUT', '--limit must be a whole number'])
})

test('a site without Jira Product Discovery answers available: false with the hint', () => {
  // Step 10, in a fresh repository: the cached discovery of the first one still names the IDEA project, and a cache that has a JPD project is not read again.
  const { pmkit } = session()
  const off = { PMKIT_FAKE_NO_DISCOVERY: '1' }
  const hint = "Create a Jira Product Discovery project on acme.atlassian.net, or check that the token's owner can browse one"
  const offList = body(pmkit(['jira', 'ideas', 'list', '--json'], off))
  assert.deepEqual([offList.available, offList.reason, offList.enableHint, offList.ideas], [false, 'no_discovery_project', hint, []])
  assert.equal(pmkit(['jira', 'ideas', 'list'], off).stdout.trim(), `Jira Product Discovery is not available on acme.atlassian.net: ${hint}`)
})
