import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { run } from './pmkit.mjs'
import { branchName } from './lib/ids.mjs'
import { hashTree, makeRepo, tempDir } from './test-helpers.mjs'
import { addBareOrigin, fakeGh, ghCalls } from './fake-gh.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'

const scratch = () => tempDir('pmkit-pr-')

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
const callJson = async (root, env, args) => {
  const result = await call(root, env, [...args, '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  return JSON.parse(result.stdout)
}
const errorOf = (result) => JSON.parse(result.stdout).error

const prJson = (overrides = {}) => JSON.stringify({ number: 7, url: 'https://github.com/o/r/pull/7', title: 'T', state: 'OPEN', isDraft: false, headRefName: 'x', author: { login: 'fred' }, mergedAt: null, ...overrides })
const view = (branch) => `pr view ${branch} --json ${VIEW}`

async function inReview(root, env, id, branch) {
  await callJson(root, env, ['issues', 'update', id, '--branch', branch])
  await callJson(root, env, ['issues', 'move', id, 'in_review'])
}

test('pr sync moves merged issues, leaves open ones and reports failed lookups', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z', state: 'MERGED' }) },
    [view('open-branch')]: { stdout: prJson({ number: 12 }) },
    [view('broken-branch')]: { status: 1, stderr: 'GraphQL: boom\n' },
  })
  const env = envWith(gh)
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  await inReview(root, env, 'ISS-5N1R', 'open-branch')
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'broken-branch'])

  const result = await callJson(root, env, ['pr', 'sync'])
  assert.equal(result.checked, 3)
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  // ISS-3Q6T has conflict markers in the fixture, so it cannot be read.
  assert.deepEqual(result.problems.map((p) => [p.id, p.code]), [['ISS-3Q6T', 'CONFLICT'], ['ISS-8C4W', 'UPSTREAM']])

  const moved = await callJson(root, env, ['issues', 'get', 'ISS-2X6D', '--history'])
  assert.equal(moved.status.category, 'done')
  const last = moved.history[moved.history.length - 1]
  assert.equal(last.field, 'status')
  assert.equal(last.by, 'fred')
  assert.equal((await callJson(root, env, ['issues', 'get', 'ISS-5N1R'])).status.category, 'in_review')
})

test('pr sync --dry-run reports the moves and leaves the repo unchanged', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } })
  const env = envWith(gh)
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  const before = hashTree(root)
  const result = await callJson(root, env, ['pr', 'sync', '--dry-run'])
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(hashTree(root), before)
})

function autoCommitRepo() {
  const root = teamRepo()
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@x.dev')
  const file = path.join(root, '.issues/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('auto_commit: false', 'auto_commit: true'))
  assert.equal(git(root, 'add', '-A').status, 0)
  assert.equal(git(root, 'commit', '-qm', 'initial').status, 0)
  return root
}

const subjects = (root) => git(root, 'log', '--format=%s').stdout

test('pr sync with nothing merged moves nothing and does not commit', async () => {
  const root = autoCommitRepo()
  const env = envWith(fakeGh({ [view('open-branch')]: { stdout: prJson() } }))
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'open-branch'])
  const before = subjects(root)
  assert.match(before, /pmkit: issues update ISS-8C4W/)
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.equal(result.checked, 1)
  assert.deepEqual(result.moved, [])
  assert.equal(subjects(root), before)
})

test('pr sync --dry-run with auto_commit true does not commit', async () => {
  const root = autoCommitRepo()
  const gh = fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } })
  try {
    const env = envWith(gh)
    await inReview(root, env, 'ISS-2X6D', 'merged-branch')
    const before = subjects(root)
    const tree = hashTree(root)
    const result = await callJson(root, env, ['pr', 'sync', '--dry-run'])
    assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
    assert.equal(subjects(root), before)
    assert.equal(hashTree(root), tree)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(gh.dir, { recursive: true, force: true })
  }
})

test('pr sync commits with the moved ids when auto_commit is on', async () => {
  const root = autoCommitRepo()
  const env = envWith(fakeGh({ [view('merged-branch')]: { stdout: prJson({ number: 11, mergedAt: '2026-10-22T10:00:00Z' }) } }))
  await inReview(root, env, 'ISS-2X6D', 'merged-branch')
  const before = subjects(root)
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.deepEqual(result.moved, [{ id: 'ISS-2X6D', pr: 11 }])
  assert.equal(git(root, 'log', '-1', '--format=%s').stdout.trim(), 'pmkit: pr sync ISS-2X6D')
  assert.notEqual(subjects(root), before)
})

test('every pr command with git_host.system none exits 2 with NOT_SUPPORTED', async () => {
  const root = teamRepo({ github: false })
  const env = envWith(fakeGh({}))
  const commands = [['pr', 'status', '--branch', 'x'], ['pr', 'sync'], ['pr', 'open', '--issue', 'ISS-2X6D'], ['pr', 'ready', '--issue', 'ISS-2X6D'], ['issues', 'branch', 'ISS-2X6D', '--dry-run']]
  for (const args of commands) {
    const result = await call(root, env, [...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    const error = errorOf(result)
    assert.equal(error.code, 'NOT_SUPPORTED')
    assert.equal(error.nextStep, 'Set git_host.system to github in .pmkit/config.yaml, or run /pmkit:setup')
  }
})

test('a PATH without gh exits 2 with NOT_CONFIGURED, and a logged out gh with AUTH', async () => {
  const root = teamRepo()
  const env = { ...envWith(fakeGh({})), PATH: scratch() }
  const missing = await call(root, env, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(missing.code, 2)
  assert.equal(errorOf(missing).code, 'NOT_CONFIGURED')

  const loggedOut = envWith(fakeGh({ [view('x')]: { status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } }))
  const auth = await call(root, loggedOut, ['pr', 'status', '--branch', 'x', '--json'])
  assert.equal(auth.code, 2)
  assert.equal(errorOf(auth).code, 'AUTH')

  await inReview(root, loggedOut, 'ISS-2X6D', 'x')
  const sync = await call(root, loggedOut, ['pr', 'sync', '--json'])
  assert.equal(sync.code, 2)
  assert.equal(errorOf(sync).code, 'AUTH')
})

test('pr status returns the pull request with checks and reviews, and an empty checks list when there are none', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr checks 7 --json name,state,bucket': { status: 1, stderr: "no checks reported on the 'feat' branch\n" },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [{ state: 'APPROVED' }], reviewRequests: [] }) },
    [view('none')]: { status: 1, stderr: 'no pull requests found for branch "none"\n' },
  })
  const env = envWith(gh)
  const status = await callJson(root, env, ['pr', 'status', '--branch', 'feat'])
  assert.equal(status.branch, 'feat')
  assert.equal(status.pr.number, 7)
  assert.deepEqual(status.checks, [])
  assert.deepEqual(status.reviews, [{ state: 'APPROVED' }])
  const none = await callJson(root, env, ['pr', 'status', '--branch', 'none'])
  assert.deepEqual(none, { branch: 'none', pr: null, checks: [], reviews: [] })
})

test('issues branch --dry-run prints the branch name and creates no git branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const env = envWith(fakeGh({}))
  const title = (await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])).title
  const before = hashTree(root)
  const result = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])
  assert.deepEqual(result, { branch: branchName('ISS-2X6D', title), from: 'main' })
  assert.equal(git(root, 'branch', '--list', result.branch).stdout.trim(), '')
  assert.equal(hashTree(root), before)
  assert.ok((await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--dry-run'])).stdout.includes(result.branch))
})

test('issues branch creates the branch and records it on the issue', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const start = git(root, 'branch', '--show-current').stdout.trim()
  const env = envWith(fakeGh({}))
  const result = await callJson(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', start])
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), result.branch)
  assert.equal(result.before.branch, undefined)
  assert.equal(result.after.branch, result.branch)
  assert.equal((await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])).branch, result.branch)
})

test('pr open without a branch on the issue exits 2 with INVALID_INPUT', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.nextStep, 'pmkit issues branch ISS-2X6D')
})

test('pr open --dry-run returns the title, body and branches without pushing or opening', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat-x')]: { status: 1, stderr: 'no pull requests found for branch "feat-x"\n' } })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'feat-x'])
  const before = hashTree(root)
  const result = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-2X6D', '--draft', '--dry-run'])
  // issues get is a read, so it writes the query index: check the tree before it.
  assert.equal(fs.existsSync(path.join(root, '.issues', '.cache')), false)
  assert.equal(hashTree(root), before)
  const issue = await callJson(root, env, ['issues', 'get', 'ISS-2X6D'])
  assert.equal(result.title, `${issue.title} (ISS-2X6D)`)
  assert.equal(result.head, 'feat-x')
  assert.equal(result.base, 'main')
  assert.equal(result.draft, true)
  assert.equal(result.existing, false)
  assert.ok(result.body.startsWith('Tracker issue: ISS-2X6D'))
  for (const item of issue.acceptanceCriteria) assert.ok(result.body.includes(`- [${item.done ? 'x' : ' '}] ${item.text}`))
  assert.deepEqual(ghCalls(gh), [view('feat-x')])
})

test('pr open pushes the branch and opens the pull request with gh', async () => {
  const root = teamRepo()
  const remote = scratch()
  addBareOrigin(root, remote)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const gh = fakeGh({
    'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main': { stdout: 'https://github.com/o/r/pull/9\n' },
    [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x' }) },
  })
  const env = envWith(gh)
  git(root, 'switch', '-c', 'feat-x')
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.number, 9)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
})

function pushableRepo() {
  const root = teamRepo()
  const remote = scratch()
  addBareOrigin(root, remote)
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'switch', '-c', 'feat-x')
  return { root, remote }
}

test('pr open on a branch that already has an open pull request pushes and returns it with existing: true', async () => {
  const { root, remote } = pushableRepo()
  const gh = fakeGh({ [view('feat-x')]: { stdout: prJson({ number: 9, headRefName: 'feat-x', isDraft: true }) } })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const dry = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W', '--dry-run'])
  assert.equal(dry.existing, true)
  assert.equal(dry.pr.number, 9)
  assert.equal(git(remote, 'branch', '--list', 'feat-x').stdout.trim(), '')
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.number, 9)
  assert.equal(pr.existing, true)
  assert.match(git(remote, 'branch', '--list', 'feat-x').stdout, /feat-x/)
  assert.ok(ghCalls(gh).every((key) => !key.startsWith('pr create')), ghCalls(gh).join('\n'))
})

test('pr open opens a new pull request when the last one on the branch is merged', async () => {
  const { root } = pushableRepo()
  const gh = fakeGh({
    [view('feat-x')]: { stdout: prJson({ number: 3, headRefName: 'feat-x', state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z' }) },
    'pr create --title Dead-letter queue for webhooks (ISS-8C4W) --body-file - --head feat-x --base main': { stdout: 'https://github.com/o/r/pull/9\n' },
  })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'feat-x'])
  const pr = await callJson(root, env, ['pr', 'open', '--issue', 'ISS-8C4W'])
  assert.equal(pr.existing, false)
  assert.ok(ghCalls(gh).some((key) => key.startsWith('pr create')))
})

test('pr ready marks the open draft pull request ready, and refuses a ready one or a missing one', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('draft-branch')]: { stdout: prJson({ number: 7, isDraft: true }) },
    'pr ready 7': { stdout: '' },
    [view(7)]: { stdout: prJson({ number: 7, isDraft: false }) },
    [view('ready-branch')]: { stdout: prJson({ number: 8, isDraft: false }) },
    [view('none-branch')]: { status: 1, stderr: 'no pull requests found for branch "none-branch"\n' },
  })
  const env = envWith(gh)
  await callJson(root, env, ['issues', 'update', 'ISS-2X6D', '--branch', 'draft-branch'])
  await callJson(root, env, ['issues', 'update', 'ISS-5N1R', '--branch', 'ready-branch'])
  await callJson(root, env, ['issues', 'update', 'ISS-8C4W', '--branch', 'none-branch'])

  const dry = await callJson(root, env, ['pr', 'ready', '--issue', 'ISS-2X6D', '--dry-run'])
  assert.equal(dry.number, 7)
  assert.ok(!ghCalls(gh).includes('pr ready 7'))
  const ready = await callJson(root, env, ['pr', 'ready', '--issue', 'ISS-2X6D'])
  assert.equal(ready.isDraft, false)
  assert.ok(ghCalls(gh).includes('pr ready 7'))

  for (const id of ['ISS-5N1R', 'ISS-8C4W']) {
    const result = await call(root, env, ['pr', 'ready', '--issue', id, '--json'])
    assert.equal(result.code, 2, id)
    assert.equal(errorOf(result).code, 'INVALID_INPUT', id)
  }
})

test('pr status on a detached HEAD asks for --branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  git(root, 'checkout', '-q', '--detach')
  const gh = fakeGh({})
  const result = await call(root, envWith(gh), ['pr', 'status', '--json'])
  assert.equal(result.code, 2)
  const error = errorOf(result)
  assert.equal(error.code, 'INVALID_INPUT')
  assert.equal(error.message, 'no current branch (detached HEAD)')
  assert.match(error.nextStep, /--branch/)
  assert.deepEqual(ghCalls(gh), [])
})

test('pr sync reports an issue file it cannot read', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const file = path.join(root, '.issues/issues/ISS-2X6D/issue.md')
  fs.writeFileSync(file, 'not: [an issue\n')
  const result = await callJson(root, env, ['pr', 'sync'])
  assert.deepEqual(result.problems.map((p) => p.id).sort(), ['ISS-2X6D', 'ISS-3Q6T'])
  assert.match((await call(root, env, ['pr', 'sync'])).stdout, /ISS-2X6D: /)
})

test('issues update refuses a branch that starts with a dash', async () => {
  const root = teamRepo()
  const env = envWith(fakeGh({}))
  const result = await call(root, env, ['issues', 'update', 'ISS-2X6D', '--branch=--receive-pack=touch pwned', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'INVALID_INPUT')
})

test('issues branch with no actor leaves no branch behind and stays on the current branch', async () => {
  const root = teamRepo()
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '--allow-empty', '-qm', 'init')
  const start = git(root, 'branch', '--show-current').stdout.trim()
  const env = envWith(fakeGh({}))
  delete env.PMKIT_USER
  const title = (await callJson(root, envWith(fakeGh({})), ['issues', 'get', 'ISS-2X6D'])).title
  for (const extra of [[], ['--dry-run']]) {
    const result = await call(root, env, ['issues', 'branch', 'ISS-2X6D', '--from', start, ...extra, '--json'])
    assert.equal(result.code, 2, result.stdout)
  }
  assert.equal(git(root, 'branch', '--show-current').stdout.trim(), start)
  assert.equal(git(root, 'branch', '--list', branchName('ISS-2X6D', title)).stdout.trim(), '')
})

function branchWithChange(root) {
  const commit = (message) => git(root, '-c', 'user.name=t', '-c', 'user.email=t@x.dev', 'commit', '-qam', message)
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  git(root, 'add', 'a.txt')
  commit('init')
  const base = git(root, 'branch', '--show-current').stdout.trim()
  git(root, 'switch', '-qc', 'feat')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n')
  commit('change')
  return base
}

const NO_PR = { status: 1, stderr: 'no pull requests found for branch "feat"\n' }

test('pr diff returns the pull request diff when the branch has a pull request', async () => {
  const root = teamRepo()
  const gh = fakeGh({
    [view('feat')]: { stdout: prJson({ number: 7 }) },
    'pr diff 7 --color never': { stdout: 'diff --git a/a b/a\n+x\n' },
  })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual(data, { branch: 'feat', source: 'pull_request', pr: JSON.parse(prJson({ number: 7 })), base: null, diff: 'diff --git a/a b/a\n+x\n', truncated: false, lines: 2 })
  const text = (await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])).stdout
  assert.match(text, /^pull request #7, 2 lines\ndiff --git a\/a b\/a\n\+x\n/)
})

test('pr diff reads the local diff when the branch has no pull request', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base])
  assert.equal(data.source, 'local')
  assert.equal(data.pr, null)
  assert.equal(data.base, base)
  assert.match(data.diff, /^diff --git a\/a\.txt b\/a\.txt/)
  assert.match(data.diff, /\+two\n\+three\n\+four\n/)
  assert.equal(data.truncated, false)
  assert.match((await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--base', base])).stdout, new RegExp(`^local diff of feat against ${base}, `))
})

test('pr diff uses the current branch and git_host.default_branch by default', async () => {
  const root = teamRepo()
  const base = branchWithChange(root)
  const file = path.join(root, '.pmkit/config.yaml')
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('default_branch: main', `default_branch: ${base}`))
  const gh = fakeGh({ [view('feat')]: NO_PR })
  const data = await callJson(root, envWith(gh), ['pr', 'diff'])
  assert.equal(data.branch, 'feat')
  assert.equal(data.base, base)
  assert.equal(data.source, 'local')
})

test('pr diff keeps the first --max-lines lines and says it cut the rest', async () => {
  const root = teamRepo()
  const log = `${Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')}\n`
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: log } })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--max-lines', '3'])
  assert.equal(data.truncated, true)
  assert.equal(data.lines, 10)
  assert.equal(data.diff, 'line 0\nline 1\nline 2\n')
  assert.match((await call(root, envWith(gh), ['pr', 'diff', '--branch', 'feat', '--max-lines', '3'])).stdout, /^pull request #7, first 3 of 10 lines\n/)
})

test('pr diff of an empty diff has no lines', async () => {
  const root = teamRepo()
  const gh = fakeGh({ [view('feat')]: { stdout: prJson({ number: 7 }) }, 'pr diff 7 --color never': { stdout: '' } })
  const data = await callJson(root, envWith(gh), ['pr', 'diff', '--branch', 'feat'])
  assert.deepEqual([data.diff, data.lines, data.truncated], ['', 0, false])
})

test('pr diff refuses bad flags before gh or git runs', async () => {
  const root = teamRepo()
  const gh = fakeGh({})
  for (const args of [['--max-lines', '0'], ['--max-lines', 'x'], ['--branch', '-x'], ['--branch', 'feat', '--base', '-y']]) {
    const result = await call(root, envWith(gh), ['pr', 'diff', ...args, '--json'])
    assert.equal(result.code, 2, args.join(' '))
    assert.equal(errorOf(result).code, 'INVALID_INPUT', args.join(' '))
  }
  assert.deepEqual(ghCalls(gh), [])
})

test('pr diff refuses a repository with no git host', async () => {
  const root = teamRepo({ github: false })
  const result = await call(root, envWith(fakeGh({})), ['pr', 'diff', '--branch', 'feat', '--json'])
  assert.equal(result.code, 2)
  assert.equal(errorOf(result).code, 'NOT_SUPPORTED')
})
