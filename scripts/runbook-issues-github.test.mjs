// E2E test of docs/runbooks/issues-github.md: the real CLI, run as a subprocess, with a fake gh first on PATH.
// The fake answers from a fixture file through answerGh (scripts/fake-github-api.mjs). Its `issues` key holds the state of the
// stateful fake GitHub (scripts/fake-github-issues.mjs), and the wrapper writes the fixture back after each call, so the state persists
// between CLI runs. Every call is logged, and no logged call may hold the token.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fakeGithubIssues } from './fake-github-issues.mjs'
import { addBareOrigin } from './fake-gh.mjs'
import { childEnv } from './golden-helpers.mjs'
import { tempDir, userStoreEnv } from './test-helpers.mjs'

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(SCRIPTS, 'pmkit.mjs')
const TOKEN = `ghp_${'Zx9Q'.repeat(9)}`
const RUNBOOK = path.join(SCRIPTS, '..', 'docs', 'runbooks', 'issues-github.md')
const BRANCH = '1-login-fails-on-safari'

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

const baseEnv = () => ({ ...childEnv(), ...userStoreEnv().env })

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x.dev', ...args], { cwd, encoding: 'utf8', env: childEnv() })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** Every GitHub issue of the fake, by number, from the saved fixture. */
const githubState = (fake) => JSON.parse(fs.readFileSync(fake.fixtureFile, 'utf8')).issues
const githubIssue = (fake, number) => githubState(fake).issues.find((issue) => issue.number === number)

const SETUP = [
  'init', '--tracker', 'github', '--git-host', 'github', '--host', 'github.com', '--repo', 'acme/widgets', '--project', 'acme/7',
  ...['backlog=Backlog', 'todo=Todo', 'in_progress=In Progress', 'in_review=In Review', 'done=Done', 'canceled=none', 'blocked=none'].flatMap((item) => ['--status', item]),
  ...['priority=issue:Priority', 'estimate=issue:Effort', 'start_date=issue:Start date', 'target_date=issue:Target date'].flatMap((item) => ['--field', item]),
  ...['feature=Feature', 'bug=Bug', 'task=Task', 'chore=none'].flatMap((item) => ['--type-label', item]),
  '--json',
]

/**
 * The state the runbook's "Before you start" describes: a git repository with `main` pushed to a bare origin, a fake GitHub whose head
 * of main is origin/main's, and the config that setup writes. `behind` commits are on origin/main only. The origin is a local folder,
 * so setup takes the host and repository from flags. Returns { root, fake, pmkit }.
 */
function runbookRepo({ behind = 0 } = {}) {
  const root = tempDir('pmkit-runbook-issues-github-')
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'commit', '--allow-empty', '-qm', 'init')
  addBareOrigin(root, tempDir('pmkit-runbook-origin-'))
  for (let index = 0; index < behind; index += 1) git(root, 'commit', '--allow-empty', '-qm', `c${index}`)
  git(root, 'push', '-q', 'origin', 'main')
  if (behind > 0) git(root, 'reset', '-q', '--hard', `HEAD~${behind}`)
  const fake = fakeGhOnPath({ meta: null, issues: fakeGithubIssues({ branches: { main: git(root, 'rev-parse', 'refs/remotes/origin/main') } }).toJSON() })
  const env = { ...baseEnv(), GH_TOKEN: TOKEN, PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
  const pmkit = (...args) => {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' })
    return { code: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  json(pmkit(...SETUP))
  fs.mkdirSync(path.join(root, 'tmp'))
  const files = {
    'title-1.txt': 'Login fails on Safari\n',
    'criteria-1.txt': '- Login works on Safari 17\n- A test covers the Safari login\n',
    'title-2.txt': 'Upgrade the session library\n',
    'title-3.txt': 'Safari users cannot log in\n',
    'comment-1.txt': 'Reproduced on Safari 17.2.\n',
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'tmp', name), text)
  return { root, fake, pmkit }
}

function json(result) {
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
  return JSON.parse(result.stdout)
}
const calls = (fake) => (fs.existsSync(fake.log) ? fs.readFileSync(fake.log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
const linkedBranchCalls = (fake) => calls(fake).filter((call) => /mutation PmkitCreateLinkedBranch\(/.test(JSON.parse(call.input).query))

function assertNoToken(fake) {
  const made = calls(fake)
  assert.ok(made.length > 0)
  for (const call of made) {
    assert.deepEqual(call.args.slice(0, 3), ['api', '--hostname', 'github.com'])
    assert.ok(!JSON.stringify(call).includes(TOKEN), 'a gh call holds the token')
  }
}

const pushNote = (from, base, dryRun) => `GitHub creates ${BRANCH} on origin at the head of ${base} there, and ${from} lacks commits of origin/${base} (as of the last fetch), so the push of pr open would be refused. ${dryRun ? `Pass --from origin/${base}` : `Run git fetch origin, then git rebase --onto origin/${base} ${from} ${BRANCH}`}`

test('the runbook names the commands this test runs', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8')
  for (const command of [
    'issues create --title-file tmp/title-1.txt --type bug --criteria-file tmp/criteria-1.txt --json',
    'issues create --title-file tmp/title-2.txt --json',
    'issues create --title-file tmp/title-3.txt --json',
    'issues list --json',
    'issues move 1 todo --json',
    'issues move 1 in_progress --json',
    'issues link 2 1 --kind blocks --json',
    'issues list --blocked --json',
    'issues parent 2 1 --json',
    'issues link 3 1 --kind duplicate --json',
    'issues comment 1 --body-file tmp/comment-1.txt --json',
    'issues branch 1 --dry-run --json',
    'issues branch 1 --json',
    'issues branch 1 --from origin/main --json',
    'issues move 1 done --json',
    'issues get 1 --history --json',
    'issues archive 1 --json',
    'issues list --archived --json',
    'issues unarchive 1 --json',
    pushNote('main', 'main', true),
    `Run git fetch origin, then git rebase --onto origin/main main ${BRANCH}`,
    'Restore the item from the archived items of the Project on GitHub',
  ]) {
    assert.ok(text.includes(command), command)
  }
})

test('runbook: the issue flows on GitHub Issues, steps 1 to 8 and 10 to 13', () => {
  const { root, fake, pmkit } = runbookRepo()

  // Step 1: three issues, the first a bug with criteria.
  const first = json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--criteria-file', 'tmp/criteria-1.txt', '--json'))
  assert.equal(first.before, null)
  assert.equal(first.after.id, '1')
  assert.equal(first.after.title, 'Login fails on Safari')
  assert.equal(first.after.type, 'bug')
  assert.deepEqual(first.after.acceptanceCriteria, [{ text: 'Login works on Safari 17', done: false }, { text: 'A test covers the Safari login', done: false }])
  assert.deepEqual(first.after.status, { name: 'Open', category: 'todo' })
  assert.equal(json(pmkit('issues', 'create', '--title-file', 'tmp/title-2.txt', '--json')).after.id, '2')
  assert.equal(json(pmkit('issues', 'create', '--title-file', 'tmp/title-3.txt', '--json')).after.id, '3')
  assert.equal(githubIssue(fake, 1).title, 'Login fails on Safari')

  // Step 2: the list.
  const listed = json(pmkit('issues', 'list', '--json'))
  assert.deepEqual(listed.issues.map((issue) => issue.id), ['1', '2', '3'])
  assert.ok(listed.issues.every((issue) => issue.status.category === 'todo'))
  assert.equal(listed.hasMore, false)

  // Step 3: todo, then in progress; the issue stays open.
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'todo', '--json')).after.status, { name: 'Todo', category: 'todo' })
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'in_progress', '--json')).after.status, { name: 'In Progress', category: 'in_progress' })
  assert.equal(githubIssue(fake, 1).state, 'OPEN')

  // Step 4: a blocker, and the blocked list.
  assert.deepEqual(json(pmkit('issues', 'link', '2', '1', '--kind', 'blocks', '--json')).after.blocks, ['1'])
  const blocked = json(pmkit('issues', 'list', '--blocked', '--json'))
  assert.deepEqual(blocked.issues.map((issue) => [issue.id, issue.blockedBy]), [['1', ['2']]])

  // Step 5: the parent.
  assert.equal(json(pmkit('issues', 'parent', '2', '1', '--json')).after.parent, '1')

  // Step 6: the duplicate closes as canceled, with the note.
  const duplicate = json(pmkit('issues', 'link', '3', '1', '--kind', 'duplicate', '--json'))
  assert.deepEqual(duplicate.after.duplicateOf, ['1'])
  assert.deepEqual(duplicate.after.status, { name: 'Closed as not planned', category: 'canceled' })
  assert.deepEqual(duplicate.notes, ['GitHub closed 3 as a duplicate of 1'])
  assert.equal(githubIssue(fake, 3).state, 'CLOSED')

  // Step 7: the comment, and the refused reply.
  const comment = json(pmkit('issues', 'comment', '1', '--body-file', 'tmp/comment-1.txt', '--json'))
  assert.equal(comment.issue, '1')
  assert.equal(comment.author, 'octocat')
  assert.equal(comment.body, 'Reproduced on Safari 17.2.')
  const reply = pmkit('issues', 'comment', '1', '--body-file', 'tmp/comment-1.txt', '--reply-to', comment.id, '--json')
  assert.equal(reply.code, 2, reply.stdout + reply.stderr)
  assert.equal(JSON.parse(reply.stdout).error.code, 'NOT_SUPPORTED')

  // Step 8: the dry run writes nothing; the real run links the branch at main's head on GitHub, with no push note.
  const dry = json(pmkit('issues', 'branch', '1', '--dry-run', '--json'))
  assert.equal(dry.branch, BRANCH)
  assert.equal(dry.from, 'main')
  assert.equal(dry.notes, undefined)
  assert.equal(linkedBranchCalls(fake).length, 0)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [])
  const head = git(root, 'rev-parse', 'refs/remotes/origin/main')
  const real = json(pmkit('issues', 'branch', '1', '--json'))
  assert.equal(real.after.branch, BRANCH)
  assert.deepEqual(real.linked, { branch: BRANCH, base: 'main' })
  assert.equal(real.notes, undefined)
  assert.equal(linkedBranchCalls(fake).length, 1)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assert.equal(githubState(fake).repositories[0].branches[BRANCH], head)
  assert.equal(git(root, 'branch', '--show-current'), BRANCH)
  assert.equal(json(pmkit('issues', 'get', '1', '--json')).branch, BRANCH)

  // Step 10: done closes the issue as completed.
  assert.deepEqual(json(pmkit('issues', 'move', '1', 'done', '--json')).after.status, { name: 'Done', category: 'done' })
  assert.deepEqual([githubIssue(fake, 1).state, githubIssue(fake, 1).stateReason], ['CLOSED', 'COMPLETED'])

  // Step 11: the history, in time order.
  const { history } = json(pmkit('issues', 'get', '1', '--history', '--json'))
  const entries = history.map((entry) => [entry.op, entry.field ?? null, entry.to?.id ?? entry.to])
  for (const expected of [['create', null, '1'], ['update', 'type', 'bug'], ['move', 'status', 'Todo'], ['move', 'status', 'In Progress'], ['move', 'status', 'Done'], ['link', 'blockedBy', '2'], ['link', 'children', '2'], ['comment', null, comment.id]]) {
    assert.ok(entries.some((entry) => JSON.stringify(entry) === JSON.stringify(expected)), `${JSON.stringify(expected)} in ${JSON.stringify(entries)}`)
  }
  assert.deepEqual(history.map((entry) => entry.at), [...history.map((entry) => entry.at)].sort())

  // Step 12: archive hides the issue from the list; --archived lists it with the others.
  const archived = json(pmkit('issues', 'archive', '1', '--json'))
  assert.equal(archived.after.archived, true)
  assert.equal(githubIssue(fake, 1).state, 'CLOSED')
  assert.deepEqual(json(pmkit('issues', 'list', '--json')).issues.map((issue) => issue.id), ['2', '3'])
  assert.deepEqual(json(pmkit('issues', 'list', '--archived', '--json')).issues.map((issue) => [issue.id, issue.archived]), [['1', true], ['2', false], ['3', false]])

  // Step 13: unarchive is not supported and points at the Project.
  const unarchive = pmkit('issues', 'unarchive', '1', '--json')
  assert.equal(unarchive.code, 2)
  assert.deepEqual(JSON.parse(unarchive.stdout).error, {
    code: 'NOT_SUPPORTED',
    message: 'unarchive works on the Local tracker only',
    nextStep: 'Restore the item from the archived items of the Project on GitHub',
  })

  assertNoToken(fake)
})

test('runbook: a main behind origin/main gets the push note, and --from origin/main avoids it (step 9)', () => {
  const { root, fake, pmkit } = runbookRepo({ behind: 1 })
  json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--type', 'bug', '--criteria-file', 'tmp/criteria-1.txt', '--json'))
  const head = git(root, 'rev-parse', 'refs/remotes/origin/main')
  assert.notEqual(git(root, 'rev-parse', 'main'), head)

  const dry = json(pmkit('issues', 'branch', '1', '--dry-run', '--json'))
  assert.ok(dry.notes.includes(pushNote('main', 'main', true)), JSON.stringify(dry.notes))

  const fixed = json(pmkit('issues', 'branch', '1', '--from', 'origin/main', '--json'))
  assert.equal(fixed.from, 'origin/main')
  assert.ok(!(fixed.notes ?? []).some((note) => note.startsWith('GitHub creates')), JSON.stringify(fixed.notes))
  assert.equal(githubState(fake).repositories[0].branches[BRANCH], head)
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assertNoToken(fake)
})

test('runbook: the real run from a main behind origin/main names the rebase (step 9)', () => {
  const { fake, pmkit } = runbookRepo({ behind: 1 })
  json(pmkit('issues', 'create', '--title-file', 'tmp/title-1.txt', '--json'))
  const real = json(pmkit('issues', 'branch', '1', '--json'))
  assert.ok(real.notes.includes(pushNote('main', 'main', false)), JSON.stringify(real.notes))
  assert.deepEqual(githubIssue(fake, 1).linkedBranches, [BRANCH])
  assertNoToken(fake)
})
