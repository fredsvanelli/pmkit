// E2E test of docs/runbooks/epics-releases-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'epics-releases-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher (a PMKIT_FAKE_NO_EPIC run sees a space without the Epic work type) that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher() {
  const dir = tempDir('pmkit-jira-epics-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues(state ? { state } : {})
const routes = { ...fake.routes }
if (process.env.PMKIT_FAKE_NO_EPIC) {
  for (const key of ['GET /rest/api/3/project/ENG', 'GET /rest/api/3/project/ENG/statuses']) {
    const json = structuredClone(routes[key].json)
    if (Array.isArray(json)) routes[key] = { json: json.filter((type) => type.name !== 'Epic') }
    else routes[key] = { json: { ...json, issueTypes: json.issueTypes.filter((type) => type.name !== 'Epic') } }
  }
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
    'epic create --title-file tmp/epic.txt --start 2026-11-23 --target 2026-12-31 --description-file tmp/epic.md --dry-run --json',
    'epic create --title-file tmp/epic.txt --start 2026-11-23 --target 2026-12-31 --description-file tmp/epic.md --json',
    'issues create --title-file tmp/title-1.txt --type feature --json',
    'issues parent ENG-2 ENG-1 --json',
    'issues list --json',
    'epic list --json',
    'epic get ENG-1 --json',
    'epic progress ENG-1 --json',
    'epic update ENG-1 --title-file tmp/epic-2.txt --json',
    'epic update-status ENG-1 --health at_risk --body-file tmp/update.md --json',
    'epic updates ENG-1 --json',
    'epic move ENG-1 in_progress --json',
    'release create 2.0 --target 2026-12-15 --dry-run --json',
    'release create 2.0 --target 2026-12-15 --json',
    'release list --json',
    'issues update ENG-2 --release 2.0 --json',
    'release issues 2.0 --json',
    'release create 10100 --json',
    'issues create --title-file tmp/title-2.txt --type feature --release 10100 --json',
    'release mark-released 2.0 --dry-run --json',
    'release mark-released 2.0 --json',
    'release create 3.0 --tag v3.0 --json',
    'milestone create m1 --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}`), command)
  assert.ok(text.includes('PMK-373'))
})

test('the epic, status update and release flows, step by step', () => {
  const { pmkit, write } = session()
  write('epic.txt', 'Launch billing')
  write('epic-2.txt', 'Launch billing v2')
  write('epic.md', 'Bill every customer monthly.')
  write('title-1.txt', 'Send the first invoice')
  write('title-2.txt', 'Send the yearly invoice')
  write('update.md', 'The payment provider is late.')

  // Capabilities
  const capabilities = body(pmkit(['capabilities', '--json'])).capabilities
  const entry = (id) => capabilities.find((item) => item.id === id)
  assert.deepEqual([entry('deliverables').path, entry('deliverables').detail], ['native', { entity: 'epic' }])
  assert.deepEqual([entry('releases').path, entry('releases').detail], ['native', { entity: 'version' }])
  assert.deepEqual([entry('status_update').path, entry('status_update').detail], ['derived', { source: 'comment' }])

  // Create an epic: a dry run, then the real one
  const create = ['epic', 'create', '--title-file', 'tmp/epic.txt', '--start', '2026-11-23', '--target', '2026-12-31', '--description-file', 'tmp/epic.md']
  const dry = body(pmkit([...create, '--dry-run', '--json']))
  assert.equal(dry.after.id, null)
  assert.deepEqual(body(pmkit(['epic', 'list', '--json'])), [])
  const epic = body(pmkit([...create, '--json'])).after
  assert.equal(epic.id, 'ENG-1')
  assert.deepEqual([epic.title, epic.status.category, epic.start, epic.target, epic.description], ['Launch billing', 'todo', '2026-11-23', '2026-12-31', 'Bill every customer monthly.'])
  assert.equal(epic.url, 'https://acme.atlassian.net/browse/ENG-1')

  // A work item under the epic; issue searches leave the epic out (ADR 0017)
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'feature', '--json'])).after.id, 'ENG-2')
  assert.equal(body(pmkit(['issues', 'parent', 'ENG-2', 'ENG-1', '--json'])).after.parent, 'ENG-1')
  assert.deepEqual(body(pmkit(['issues', 'list', '--json'])).issues.map((issue) => issue.id), ['ENG-2'])
  assert.deepEqual(body(pmkit(['epic', 'list', '--json'])).map((item) => item.id), ['ENG-1'])
  assert.equal(body(pmkit(['epic', 'get', 'ENG-1', '--json'])).title, 'Launch billing')
  const progress = body(pmkit(['epic', 'progress', 'ENG-1', '--json']))
  assert.deepEqual([progress.total, progress.done, progress.open], [1, 0, ['ENG-2']])

  // Edit, status update, move
  assert.equal(body(pmkit(['epic', 'update', 'ENG-1', '--title-file', 'tmp/epic-2.txt', '--json'])).after.title, 'Launch billing v2')
  const published = body(pmkit(['epic', 'update-status', 'ENG-1', '--health', 'at_risk', '--body-file', 'tmp/update.md', '--json']))
  assert.deepEqual([published.after.health, published.after.body, published.after.author], ['at_risk', 'The payment provider is late.', 'acc-1'])
  const updates = body(pmkit(['epic', 'updates', 'ENG-1', '--json']))
  assert.deepEqual(updates.map((update) => [update.health, update.body]), [['at_risk', 'The payment provider is late.']])
  assert.equal(body(pmkit(['epic', 'get', 'ENG-1', '--json'])).health, 'at_risk')
  const moved = body(pmkit(['epic', 'move', 'ENG-1', 'in_progress', '--json']))
  assert.deepEqual([moved.before.status.category, moved.after.status.name], ['todo', 'In Progress'])

  // Releases: create, assign, filter, mark released
  const releaseDry = body(pmkit(['release', 'create', '2.0', '--target', '2026-12-15', '--dry-run', '--json']))
  assert.equal(releaseDry.after.id, '2.0')
  assert.deepEqual(body(pmkit(['release', 'list', '--json'])), [])
  const release = body(pmkit(['release', 'create', '2.0', '--target', '2026-12-15', '--json'])).after
  assert.deepEqual(release, { id: '2.0', name: '2.0', target: '2026-12-15', state: 'planned', description: '' })
  assert.deepEqual(body(pmkit(['release', 'list', '--json'])).map((item) => item.id), ['2.0'])
  assert.equal(body(pmkit(['issues', 'update', 'ENG-2', '--release', '2.0', '--json'])).after.release, '2.0')
  assert.deepEqual(body(pmkit(['release', 'issues', '2.0', '--json'])).map((issue) => issue.id), ['ENG-2'])
  // Jira's fixVersion = <id> also matches a version named like the id; the release still lists only its own items (PMK-373).
  assert.equal(body(pmkit(['release', 'create', '10100', '--json'])).after.id, '10100')
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-2.txt', '--type', 'feature', '--release', '10100', '--json'])).after.id, 'ENG-3')
  assert.deepEqual(body(pmkit(['release', 'issues', '2.0', '--json'])).map((issue) => issue.id), ['ENG-2'])
  const markDry = body(pmkit(['release', 'mark-released', '2.0', '--dry-run', '--json']))
  assert.equal(markDry.after.state, 'released')
  assert.equal(body(pmkit(['release', 'list', '--json']))[0].state, 'planned')
  const marked = body(pmkit(['release', 'mark-released', '2.0', '--json']))
  assert.deepEqual([marked.after.state, marked.after.released], ['released', '2026-11-22T12:00:00Z'])
  assert.deepEqual(marked.unfinished.map((issue) => issue.id), ['ENG-2'])

  // What Jira does not have
  const tag = failure(pmkit(['release', 'create', '3.0', '--tag', 'v3.0', '--json']))
  assert.deepEqual([tag.code, tag.nextStep], ['INVALID_INPUT', 'Drop --tag on Jira'])
  const milestone = failure(pmkit(['milestone', 'create', 'm1', '--json']))
  assert.deepEqual([milestone.code, milestone.message], ['NOT_SUPPORTED', 'Jira has no milestones'])
})

test('a space without an Epic work type has no epics', () => {
  const { pmkit } = session()
  const error = failure(pmkit(['epic', 'list', '--json'], { PMKIT_FAKE_NO_EPIC: '1' }))
  assert.deepEqual([error.code, error.message, error.nextStep], ['NOT_SUPPORTED', 'Space ENG has no epic work type', '/pmkit:setup'])
})
