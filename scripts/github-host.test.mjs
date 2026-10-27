import assert from 'node:assert/strict'
import test from 'node:test'
import { PmkitError } from './lib/errors.mjs'
import { createGithubHost, defaultExec } from './lib/github/host.mjs'

const VIEW_FIELDS = 'number,url,title,state,isDraft,headRefName,author,mergedAt'

/** An exec that records calls and answers from a queue of results or functions. */
function fakeExec(...results) {
  const calls = []
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args, ...options })
    const next = results.shift() ?? { status: 0, stdout: '', stderr: '' }
    if (typeof next === 'function') return next()
    return { status: 0, stdout: '', stderr: '', ...next }
  }
  return { exec, calls }
}

const host = (exec) => createGithubHost({ root: '/repo', env: {}, exec })

const pr = {
  number: 12,
  url: 'https://github.com/o/r/pull/12',
  title: 'T',
  state: 'OPEN',
  isDraft: true,
  headRefName: 'iss-7k3q-retry',
  author: { login: 'fred' },
  mergedAt: null,
}

test('getPullRequest by head calls gh pr view and parses the JSON', () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(pr) })
  assert.deepEqual(host(exec).getPullRequest({ head: 'iss-7k3q-retry' }), pr)
  assert.deepEqual(calls[0].cmd, 'gh')
  assert.deepEqual(calls[0].args, ['pr', 'view', 'iss-7k3q-retry', '--json', VIEW_FIELDS])
})

test('getPullRequest by number passes the number as text', () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(pr) })
  host(exec).getPullRequest({ number: 12 })
  assert.deepEqual(calls[0].args, ['pr', 'view', '12', '--json', VIEW_FIELDS])
})

test('getPullRequest returns null when gh finds no pull request', () => {
  const { exec } = fakeExec({ status: 1, stderr: 'no pull requests found for branch "x"\n' })
  assert.equal(host(exec).getPullRequest({ head: 'x' }), null)
})

test('getPullRequest needs a number or a head', () => {
  const { exec } = fakeExec()
  assert.throws(() => host(exec).getPullRequest({}), (e) => e.code === 'INVALID_INPUT')
})

test('openPullRequest sends the body on stdin, then reads the PR back', () => {
  const { exec, calls } = fakeExec({ stdout: 'https://github.com/o/r/pull/12\n' }, { stdout: JSON.stringify(pr) })
  const result = host(exec).openPullRequest({ title: 'T', body: 'B', head: 'h', base: 'main', draft: true })
  assert.deepEqual(calls[0].args, ['pr', 'create', '--title', 'T', '--body-file', '-', '--head', 'h', '--base', 'main', '--draft'])
  assert.equal(calls[0].input, 'B')
  assert.deepEqual(calls[1].args, ['pr', 'view', 'h', '--json', VIEW_FIELDS])
  assert.deepEqual(result, pr)
})

test('openPullRequest omits --draft when draft is false', () => {
  const { exec, calls } = fakeExec({}, { stdout: JSON.stringify(pr) })
  host(exec).openPullRequest({ title: 'T', body: 'B', head: 'h', base: 'main', draft: false })
  assert.ok(!calls[0].args.includes('--draft'))
})

test('prChecks and prReviews call gh with the spec flags', () => {
  const { exec, calls } = fakeExec({ stdout: '[{"name":"ci","state":"SUCCESS","bucket":"pass"}]' }, { stdout: '{"reviews":[],"reviewRequests":[]}' })
  const h = host(exec)
  assert.deepEqual(h.prChecks(12), [{ name: 'ci', state: 'SUCCESS', bucket: 'pass' }])
  assert.deepEqual(h.prReviews(12), { reviews: [], reviewRequests: [] })
  assert.deepEqual(calls[0].args, ['pr', 'checks', '12', '--json', 'name,state,bucket'])
  assert.deepEqual(calls[1].args, ['pr', 'view', '12', '--json', 'reviews,reviewRequests'])
})

test('prChecks keeps the list when gh exits non-zero for failing or pending checks', () => {
  const { exec } = fakeExec({ status: 8, stdout: '[{"name":"ci","state":"PENDING","bucket":"pending"}]' })
  assert.equal(host(exec).prChecks(12)[0].bucket, 'pending')
})

test('prChecks returns an empty list when gh reports no checks', () => {
  const { exec } = fakeExec({ status: 1, stderr: "no checks reported on the 'iss-1' branch\n" })
  assert.deepEqual(host(exec).prChecks(12), [])
})

test('listPullRequests calls gh pr list with the open state, the limit and the fields', () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify([pr]) })
  assert.deepEqual(host(exec).listPullRequests(), [pr])
  assert.equal(calls[0].cmd, 'gh')
  assert.deepEqual(calls[0].args, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,title,headRefName,isDraft,updatedAt,author,statusCheckRollup'])
})

test('listRuns calls gh run list on the branch with the limit and the fields', () => {
  const { exec, calls } = fakeExec({ stdout: '[]' })
  assert.deepEqual(host(exec).listRuns({ branch: 'main' }), [])
  assert.deepEqual(calls[0].args, ['run', 'list', '--branch', 'main', '--limit', '50', '--json', 'databaseId,workflowName,status,conclusion,url,createdAt,headSha'])
})

test('listRuns refuses a branch that starts with a dash before gh runs', () => {
  const { exec, calls } = fakeExec()
  assert.throws(() => host(exec).listRuns({ branch: '-x' }), (e) => e instanceof PmkitError && e.code === 'INVALID_INPUT')
  assert.deepEqual(calls, [])
})

test('listPullRequests maps a logged out gh to AUTH and a missing gh to NOT_CONFIGURED', () => {
  const loggedOut = fakeExec({ status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' })
  assert.throws(() => host(loggedOut.exec).listPullRequests(), (e) => e instanceof PmkitError && e.code === 'AUTH')
  const missing = fakeExec(() => {
    throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' })
  })
  assert.throws(() => host(missing.exec).listPullRequests(), (e) => e instanceof PmkitError && e.code === 'NOT_CONFIGURED')
})

test('listRuns maps a failure to UPSTREAM and unreadable JSON to UPSTREAM', () => {
  const failed = fakeExec({ status: 1, stderr: 'HTTP 404: Not Found\n' })
  assert.throws(() => host(failed.exec).listRuns({ branch: 'main' }), (e) => e.code === 'UPSTREAM' && e.message.includes('HTTP 404'))
  const garbled = fakeExec({ stdout: 'not json' })
  assert.throws(() => host(garbled.exec).listRuns({ branch: 'main' }), (e) => e.code === 'UPSTREAM')
})

test('a thrown ENOENT becomes NOT_CONFIGURED', () => {
  const { exec } = fakeExec(() => {
    throw Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' })
  })
  assert.throws(
    () => host(exec).getPullRequest({ head: 'x' }),
    (e) =>
      e instanceof PmkitError &&
      e.code === 'NOT_CONFIGURED' &&
      e.nextStep === 'Install the GitHub CLI (https://cli.github.com) and run gh auth login',
  )
})

test('stderr mentioning gh auth login becomes AUTH', () => {
  const { exec } = fakeExec({ status: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' })
  assert.throws(
    () => host(exec).getPullRequest({ head: 'x' }),
    (e) => e.code === 'AUTH' && e.nextStep === 'gh auth login',
  )
})

test('stderr mentioning rate limit becomes RATE_LIMITED', () => {
  const { exec } = fakeExec({ status: 1, stderr: 'API rate limit exceeded\n' })
  assert.throws(() => host(exec).prChecks(1), (e) => e.code === 'RATE_LIMITED')
})

test('any other failure becomes UPSTREAM with the first stderr line', () => {
  const { exec } = fakeExec({ status: 1, stderr: 'boom happened\nsecond line\n' })
  assert.throws(
    () => host(exec).prReviews(1),
    (e) => e.code === 'UPSTREAM' && e.message.includes('boom happened') && !e.message.includes('second line'),
  )
})

test('git operations call git with the spec arguments', () => {
  const { exec, calls } = fakeExec({}, {}, { stdout: ' feat/x \n' })
  const h = host(exec)
  h.createBranch('iss-7k3q-retry', { from: 'main' })
  h.push('b')
  assert.equal(h.currentBranch(), 'feat/x')
  assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
    ['git', 'switch', '-c', 'iss-7k3q-retry', 'main'],
    ['git', 'push', '-u', 'origin', 'b'],
    ['git', 'branch', '--show-current'],
  ])
})

test('a branch, head or base that starts with a dash is refused before git or gh runs', () => {
  const { exec, calls } = fakeExec()
  const h = host(exec)
  const refused = (e) => e instanceof PmkitError && e.code === 'INVALID_INPUT'
  assert.throws(() => h.createBranch('--receive-pack=x', { from: 'main' }), refused)
  assert.throws(() => h.createBranch('ok', { from: '-x' }), refused)
  assert.throws(() => h.push('--receive-pack=touch pwned'), refused)
  assert.throws(() => h.getPullRequest({ head: '-x' }), refused)
  assert.throws(() => h.openPullRequest({ title: 'T', body: 'B', head: '--x', base: 'main', draft: false }), refused)
  assert.throws(() => h.openPullRequest({ title: 'T', body: 'B', head: 'h', base: '-main', draft: false }), refused)
  assert.deepEqual(calls, [])
})

test('markReady calls gh pr ready with the number, then reads the PR back', () => {
  const { exec, calls } = fakeExec({}, { stdout: JSON.stringify({ ...pr, isDraft: false }) })
  const result = host(exec).markReady(12)
  assert.deepEqual(calls.map((c) => c.args), [['pr', 'ready', '12'], ['pr', 'view', '12', '--json', VIEW_FIELDS]])
  assert.equal(result.isDraft, false)
})

test('the default exec throws ENOENT for a command that does not exist', () => {
  assert.throws(
    () => defaultExec({ root: process.cwd(), env: process.env })('pmkit-no-such-command-xyz', []),
    (e) => e.code === 'ENOENT',
  )
})

test('the default exec returns status, stdout and stderr', () => {
  const run = defaultExec({ root: process.cwd(), env: process.env })
  const result = run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hi' })
  assert.deepEqual(result, { status: 0, stdout: 'hi', stderr: '' })
})
