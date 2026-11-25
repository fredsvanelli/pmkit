// E2E test of docs/runbooks/issues-jira.md: the real CLI as a subprocess, with globalThis.fetch replaced by the stateful fake Jira
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
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'issues-jira.md')
const url = (name) => pathToFileURL(path.join(SCRIPTS, name)).href

/** Writes a launcher that loads the fake's state from state.json beside it (absent: fresh), runs the CLI and saves the state. */
function launcher(locale = 'en') {
  const dir = tempDir('pmkit-jira-issues-launcher-')
  const file = path.join(dir, 'launch.mjs')
  fs.writeFileSync(file, `import fs from 'node:fs'
import { fakeJiraFetch } from ${JSON.stringify(url('fake-jira-api.mjs'))}
import { fakeJiraIssues } from ${JSON.stringify(url('fake-jira-issues.mjs'))}
const stateFile = ${JSON.stringify(path.join(dir, 'state.json'))}
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : undefined
const fake = fakeJiraIssues({ ...(state ? { state } : {}), locale: ${JSON.stringify(locale)} })
globalThis.fetch = fakeJiraFetch(fake.routes)
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

function session({ locale } = {}) {
  const root = jiraRepo()
  const launch = launcher(locale)
  const pmkit = (args) => {
    const result = spawnSync(process.execPath, [launch, ...args], { cwd: root, env: { ...childEnv(), ...FAKE_ENV, PMKIT_NOW: '2026-11-22T12:00:00Z' }, encoding: 'utf8' })
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
    'issues create --title-file tmp/title-1.txt --type feature --criteria-file tmp/criteria-1.txt --json',
    'issues create --title-file tmp/title-2.txt --type bug --json',
    'issues list --type feature --assignee none --json',
    'issues move ENG-1 in_progress --json',
    'issues move ENG-1 done --dry-run --json',
    'issues move ENG-1 done --json',
    'issues move ENG-1 done --field resolution=Done --json',
    'issues link ENG-2 ENG-1 --kind blocks --json',
    'issues list --blocked --json',
    'issues parent ENG-2 ENG-1 --json',
    'issues comment ENG-1 --body-file tmp/comment-1.txt --json',
    'issues get ENG-1 --history --json',
    'issues branch ENG-1 --json',
    'issues create --title-file tmp/title-3.txt --json',
    'issues delete ENG-2 --json',
    'issues delete ENG-3 --json',
    'issues create --title-file tmp/title-1.txt --type bug --json',
    'metrics cycle-time --json',
  ]
  for (const command of commands) assert.ok(text.includes(`node scripts/pmkit.mjs ${command}`), command)
})

test('the issue flows, step by step', () => {
  const { pmkit, write, root } = session()
  write('title-1.txt', 'Ship it')
  write('criteria-1.txt', '- It ships\n- A test covers it\n')
  write('title-2.txt', 'Prepare the release')
  write('title-3.txt', 'Scratch item')
  write('comment-1.txt', 'Waiting on the release notes.')

  // Create and list
  const first = body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'feature', '--criteria-file', 'tmp/criteria-1.txt', '--json']))
  assert.equal(first.before, null)
  assert.equal(first.after.id, 'ENG-1')
  assert.equal(first.after.type, 'feature')
  assert.equal(first.after.acceptanceCriteria.length, 2)
  assert.equal(first.after.status.category, 'todo')
  const second = body(pmkit(['issues', 'create', '--title-file', 'tmp/title-2.txt', '--type', 'bug', '--json']))
  assert.equal(second.after.id, 'ENG-2')
  const listed = body(pmkit(['issues', 'list', '--type', 'feature', '--assignee', 'none', '--json']))
  assert.deepEqual(listed.issues.map((issue) => issue.id), ['ENG-1'])

  // Move, through a Resolution screen
  const moved = body(pmkit(['issues', 'move', 'ENG-1', 'in_progress', '--json']))
  assert.equal(moved.after.status.category, 'in_progress')
  const dry = body(pmkit(['issues', 'move', 'ENG-1', 'done', '--dry-run', '--json']))
  assert.equal(dry.requiredFields[0].name, 'Resolution')
  const refused = pmkit(['issues', 'move', 'ENG-1', 'done', '--json'])
  assert.equal(refused.code, 2, refused.stdout)
  assert.equal(JSON.parse(refused.stdout).error.code, 'INVALID_INPUT')
  assert.equal(body(pmkit(['issues', 'get', 'ENG-1', '--json'])).status.category, 'in_progress')

  // Links, parent, comment
  const linked = body(pmkit(['issues', 'link', 'ENG-2', 'ENG-1', '--kind', 'blocks', '--json']))
  assert.deepEqual(linked.after.blocks, ['ENG-1'])
  const blocked = body(pmkit(['issues', 'list', '--blocked', '--json']))
  assert.deepEqual(blocked.issues.map((issue) => issue.id), ['ENG-1'])
  const parented = body(pmkit(['issues', 'parent', 'ENG-2', 'ENG-1', '--json']))
  assert.equal(parented.after.parent, 'ENG-1')
  body(pmkit(['issues', 'comment', 'ENG-1', '--body-file', 'tmp/comment-1.txt', '--json']))

  // Branch, then the history
  const branched = body(pmkit(['issues', 'branch', 'ENG-1', '--json']))
  assert.equal(branched.branch, 'ENG-1-ship-it')
  assert.equal(branched.after.branch, 'ENG-1-ship-it')
  assert.equal(git(root, 'branch', '--list', 'ENG-1-ship-it').replace(/^[*+]?\s+/, ''), 'ENG-1-ship-it')
  assert.equal(body(pmkit(['issues', 'get', 'ENG-1', '--json'])).branch, 'ENG-1-ship-it')
  const done = body(pmkit(['issues', 'move', 'ENG-1', 'done', '--field', 'resolution=Done', '--json']))
  assert.deepEqual(done.after.status, { name: 'Done', category: 'done' })
  const got = body(pmkit(['issues', 'get', 'ENG-1', '--history', '--json']))
  assert.deepEqual(got.history.map((event) => event.op), ['create', 'move', 'link', 'comment', 'move', 'update'])
  assert.deepEqual(got.history.at(-1), { ...got.history.at(-1), field: 'jira:resolution', from: null, to: 'Done' })

  // Delete an item nothing references
  const refusedDelete = pmkit(['issues', 'delete', 'ENG-2', '--json'])
  assert.equal(refusedDelete.code, 2, refusedDelete.stdout)
  const deleteError = JSON.parse(refusedDelete.stdout).error
  assert.equal(deleteError.code, 'CONFLICT')
  assert.ok(deleteError.message.includes('ENG-1'), deleteError.message)
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-3.txt', '--json'])).after.id, 'ENG-3')
  const gone = body(pmkit(['issues', 'delete', 'ENG-3', '--json']))
  assert.equal(gone.after, null)
  assert.equal(pmkit(['issues', 'get', 'ENG-3', '--json']).code, 2)
})

test('on a site in another language, the history and the metrics read the statuses as the site shows them', () => {
  const { pmkit, write, root } = session({ locale: 'pt' })
  // The site shows Story as História, so the mapping holds the shown name, as setup writes it (PMK-368).
  const config = path.join(root, '.pmkit', 'config.yaml')
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('feature: Story', 'feature: História'))
  write('title-1.txt', 'Ship it')
  assert.equal(body(pmkit(['issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--json'])).after.id, 'ENG-1')
  body(pmkit(['issues', 'move', 'ENG-1', 'in_progress', '--json']))
  assert.deepEqual(body(pmkit(['issues', 'move', 'ENG-1', 'done', '--field', 'resolution=Done', '--json'])).after.status, { name: 'Concluído', category: 'done' })
  const { history } = body(pmkit(['issues', 'get', 'ENG-1', '--history', '--json']))
  assert.equal(history[0].to.status, 'Tarefas pendentes')
  assert.deepEqual(history.filter((event) => event.op === 'move').map((event) => [event.from, event.to]), [['Tarefas pendentes', 'Em andamento'], ['Em andamento', 'Concluído']])
  assert.deepEqual(body(pmkit(['metrics', 'cycle-time', '--json'])).issues.map((entry) => entry.issue), ['ENG-1'])
})
