import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { branchName } from './lib/ids.mjs'
import { hashTree, makeRepo } from './test-helpers.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'

// The fake gh answers from the JSON file named by PMKIT_FAKE_GH: args joined by a space map to { status, stdout, stderr }.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs')
const key = process.argv.slice(2).join(' ')
const canned = JSON.parse(fs.readFileSync(process.env.PMKIT_FAKE_GH, 'utf8'))
const answer = canned[key]
if (!answer) {
  process.stderr.write('fake gh: no canned response for ' + key + '\\n')
  process.exit(1)
}
process.stdout.write(answer.stdout ?? '')
process.stderr.write(answer.stderr ?? '')
process.exit(answer.status ?? 0)
`

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmkit-pr-'))

function fakeGh(canned) {
  const dir = scratch()
  fs.writeFileSync(path.join(dir, 'gh'), FAKE_GH, { mode: 0o755 })
  fs.chmodSync(path.join(dir, 'gh'), 0o755)
  const responses = path.join(dir, 'responses.json')
  fs.writeFileSync(responses, JSON.stringify(canned))
  return { dir, responses }
}

const envWith = ({ dir, responses }) => ({
  ...process.env,
  PATH: `${dir}${path.delimiter}${process.env.PATH}`,
  PMKIT_FAKE_GH: responses,
  PMKIT_USER: 'fred',
  PMKIT_NOW: '2026-10-23T12:00:00Z',
  PMKIT_SEED: '1',
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
})

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' } })

function teamRepo({ github = true } = {}) {
  const root = makeRepo('team')
  git(root, 'init', '-q')
  if (github) {
    const file = path.join(root, '.pmkit/config.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('system: none', 'system: github\n  default_branch: main'))
  }
  return root
}

const call = (root, env, args) => run(args, { env, cwd: root })
const callJson = (root, env, args) => {
  const result = call(root, env, [...args, '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => JSON.parse(result.stdout).error

const prJson = (overrides = {}) => JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', state: 'OPEN', isDraft: false, headRefName: 'x', author: { login: 'fred' }, mergedAt: null, ...overrides })
const view = (branch) => `pr view ${branch} --json ${VIEW}`

function inReview(root, env, id, branch) {
  callJson(root, env, ['issues', 'update', id, '--branch', branch])
  callJson(root, env, ['issues', 'move', id, 'in_review'])
}

test('pr sync moves merged issues, leaves open ones and reports failed lookups', () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z', state: 'MERGED' }) },
    [view('open-branch')]: { stdout: prJson({ number: 12 }) },
    [view('broken-branch')]: { status: 1, stderr: 'GraphQL: boom\n' },
  })
  const env = envWith(gh)
  inReview(root, env, 'ISS-2X6D', 'merged-branch')
  inReview(root, env, 'ISS-5N1R', 'open-branch')
  callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'broken-branch'])

  const result = callJson(root, env, ['pr', 'sync'])
  assert.equal(result.checked, 3)
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].id, 'ISS-8C4W')
  assert.equal(result.problems[0].code, 'UPSTREAM')

  const moved = callJson(root, env, ['issues', 'get', 'ISS-2X6D', '--history'])
  assert.equal(moved.status.category, 'done')
  const last = moved.history[moved.history.length - 1]
  assert.equal(last.field, 'status')
  assert.equal(last.by, 'fred')
  assert.equal(callJson(root, env, ['issues', 'get', 'ISS-5N1R']).status.category, 'in_review')
})

test('pr sync --dry-run reports the moves and leaves the repo unchanged', () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } })
  const env = envWith(gh)
  inReview(root, env, 'ISS-2X6D', 'merged-branch')
  const before = hashTree(root)
  const result = callJson(root, env, ['pr', 'sync', '--dry-run'])
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(hashTree(root), before)
})

test('pr sync with nothing merged moves nothing and does not commit', () => {
  const root = teamRepo()
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  const gh = fakeGh({ [view('open-branch')]: { stdout: prJson() } })
  const env = envWith(gh)
  callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'open-branch'])
  const commits = () => git(root, 'log', '--oneline').stdout
  const before = commits()
  const result = callJson(root, env, ['pr', 'sync'])
  assert.deepEqual(result.moved, [])
  assert.equal(commits(), before)
})

test('every pr command with git_host.system none exits 2 with NOT_SUPPORTED', () => {
  const root = teamRepo({ github: false })
  const env = envWith(fakeGh({}))
  for (const args of [['pr', 'status', '--branch', 'x'], ['pr', 'sync'], ['pr', 'open', '--issue', 'ISS-2X6D']]) {
    const result = call(root, env, [...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    const error = errorOf(result)
    assert.equal(error.code, 'NOT_SUPPORTED')
    assert.equal(error.nextStep, 'Set git_host.system to github in .pmkit/config.yaml, or run /pmkit:setup')
  }
})

test('a PATH without gh exits 2 with NOT_CONFIGURED, and a logged out gh with AUTH', () => {
  const root = teamRepo()
  const env = { ...envWith(fakeGh({})), PATH: scratch() }
  const missing = call(root, env, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(missing.code, 2)
  assert.equal(errorOf(missing).code, 'NOT_CONFIGURED')

  const loggedOut = envWith(fakeGh({ [view('x')]: { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } }))
  const auth = call(root, loggedOut, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(auth.code, 2)
  assert.equal(errorOf(auth).code, 'AUTH')

  inReview(root, loggedOut, 'ISS-2X6D', 'x')
  const sync = call(root, loggedOut, ['pr', 'sync', '--json'])
  assert.equal(sync.code, 2)
  assert.equal(errorOf(sync).code, 'AUTH')
})

test('pr status returns the pull request with checks and reviews, and an empty checks list when there are none', () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket': { status: 1, stderr: "no checks reported on the 'feat' branch\n" },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [{ state: 'APPROVED' }], reviewRequests: [] }) },
    [view('none')]: { status: 1, stderr: 'no pull requests found for branch "none"\n' },
  })
  const env = envWith(gh)
  const status = callJson(root, env, ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.branch, 'feat')
  assert.equal(status.pr.number, 7)
  assert.deepEqual(status.checks, [])
  assert.deepEqual(status.reviews, [{ state: 'APPROVED' }])
  const none = callJson(root, env, ['pr', 'status', '--branch', 'none'])
  assert.deepEqual(none, { branch: 'none', pr: null, checks: [], reviews: [] })
})

test('issues branch --dry-run prints the branch name and creates no git branch', () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const env = envWith(fakeGh({}))
  const title = callJson(root, env, ['issues', 'get', 'ISS-2X6D']).title
  const before = hashTree(root)
  const result = callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  assert.deepEqual(result, { branch: branchName('ISS-2X6D', title), from: 'main' })
  assert.equal(git(root, 'branch', '--list', result.branch).stdout.trim(), '')
  assert.equal(hashTree(root), before)
  assert.ok(call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run']).stdout.includes(result.branch))
})

test('issues branch creates the branch and records it on the issue', () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const start = git(root, 'branch', '--show-current').stdout.trim()
  const env = envWith(fakeGh({}))
  const result = callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', start])
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), result.branch)
  assert.equal(result.before.branch, undefined)
  assert.equal(result.after.branch, result.branch)
  assert.equal(callJson(root, env, ['issues', 'get', 'ISS-2X6D']).branch, result.branch)
})

test('pr open without a branch on the issue exits 2 with INVALID_INPUT', () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const result = call(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'pmkit issues branch ISS-2X6D')
})

test('pr open --dry-run returns the title, body and branches without running git or gh', () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'feat-x'])
  const before = hashTree(root)
  const result = callJson(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--draft', '--dry-run'])
  const issue = callJson(root, env, ['issues', 'get', 'ISS-2X6D'])
  assert.equal(result.title, `${issue.title} (ISS-2X6D)`)
  assert.equal(result.head, 'feat-x')
  assert.equal(result.base, 'main')
  assert.equal(result.draft, true)
  assert.ok(result.body.startsWith('Tracker issue: ISS-2X6D'))
  for (const item of issue.acceptanceCriteria) assert.ok(result.body.includes(`- [${item.done ? 'x' : ' '}] ${item.text}`))
  assert.equal(hashTree(root), before)
})

test('pr open pushes the branch and opens the pull request with gh', () => {
  const root = teamRepo()
  const remote = scratch()
  git(remote, 'init', '-q', '--bare')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const gh = fakeGh({
    'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main': { stdout: 'https://github.com/o/r/pull/9\n' },
    [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x' }) },
  })
  const env = envWith(gh)
  git(root, 'switch', '-c', 'feat-x')
  callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const pr = callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.number, 9)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
})
