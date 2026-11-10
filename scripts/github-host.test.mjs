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
  const { exec, calls } = fakeExec({ stdout: '[{"name":"ci","state":"SUCCESS","bucket":"pass","link":"https://github.com/o/r/actions/runs/77/job/5"}]' }, { stdout: '{"reviews":[],"reviewRequests":[]}' })
  const h = host(exec)
  assert.deepEqual(h.prChecks(12), [{ name: 'ci', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/77/job/5', runId: 77 }])
  assert.deepEqual(h.prReviews(12), { reviews: [], reviewRequests: [] })
  assert.deepEqual(calls[0].args, ['pr', 'checks', '12', '--json', 'name,state,bucket,link'])
  assert.deepEqual(calls[1].args, ['pr', 'view', '12', '--json', 'reviews,reviewRequests'])
})

test('prChecks gives runId null for a check whose link is not a workflow run', () => {
  const { exec } = fakeExec({ stdout: '[{"name":"a","bucket":"fail","link":"https://ci.example.com/b/1"},{"name":"b","bucket":"fail","link":""},{"name":"c","bucket":"fail"}]' })
  assert.deepEqual(host(exec).prChecks(12).map((c) => c.runId), [null, null, null])
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

const depList = [
  { id: 5, node_id: 'N5', environment: 'production', ref: 'main', sha: 'abc', created_at: '2026-10-29T10:00:00Z' },
  { id: 4, node_id: 'N4', environment: 'staging', ref: 'main', sha: 'def', created_at: '2026-10-28T10:00:00Z' },
]
const statusReply = (...nodes) => ({ stdout: JSON.stringify({ data: { nodes } }) })
const row = (d, extra) => ({ id: d.id, environment: d.environment, ref: d.ref, sha: d.sha, createdAt: d.created_at, ...extra })

test('listDeploys reads the deployments, then every latest status in one graphql call', () => {
  const { exec, calls } = fakeExec(
    { stdout: JSON.stringify(depList) },
    statusReply({ latestStatus: { state: 'SUCCESS', logUrl: 'https://l/5', environmentUrl: null } }, { latestStatus: null }),
  )
  const result = host(exec).listDeploys({})
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, ['api', 'repos/{owner}/{repo}/deployments?per_page=20'])
  // The real gh refuses a field with no -f or -F before it ("accepts 1 arg(s), received 3").
  assert.deepEqual(calls[1].args.filter((a) => a.startsWith('query=')).length, 1)
  assert.deepEqual(calls[1].args.slice(0, 3), ['api', 'graphql', '-f'])
  assert.deepEqual(calls[1].args.slice(4), ['-f', 'ids[]=N5', '-f', 'ids[]=N4'])
  assert.deepEqual(result, [
    row(depList[0], { state: 'success', url: 'https://l/5' }),
    row(depList[1], { state: 'pending', url: null }),
  ])
})

test('listDeploys with no deployments makes no graphql call', () => {
  const { exec, calls } = fakeExec({ stdout: '[]' })
  assert.deepEqual(host(exec).listDeploys({}), [])
  assert.equal(calls.length, 1)
})

test('listDeploys keeps the list with an unknown state when the status read fails', () => {
  const { exec } = fakeExec({ stdout: JSON.stringify(depList) }, { status: 1, stderr: 'HTTP 502: Bad Gateway' })
  const result = host(exec).listDeploys({})
  assert.deepEqual(result.map((d) => [d.id, d.state, d.url]), [[5, null, null], [4, null, null]])
  assert.match(result[0].statusError, /502/)
})

test('listDeploys marks only the deployment whose node graphql did not return as unknown', () => {
  const { exec } = fakeExec({ stdout: JSON.stringify(depList) }, statusReply({ latestStatus: { state: 'FAILURE', logUrl: null, environmentUrl: 'https://e/5' } }, null))
  const result = host(exec).listDeploys({})
  assert.deepEqual([result[0].state, result[0].url, result[0].statusError], ['failure', null, undefined])
  assert.equal(result[1].state, null)
  assert.match(result[1].statusError, /no status/)
})

test('listDeploys uses the statuses of a partial graphql reply that gh exits non-zero on', () => {
  const partial = { data: { nodes: [{ latestStatus: { state: 'SUCCESS', logUrl: 'https://l/5' } }, null] }, errors: [{ type: 'NOT_FOUND', path: ['nodes', 1], message: 'Could not resolve to a node with the global id of N4' }] }
  const { exec } = fakeExec({ stdout: JSON.stringify(depList) }, { status: 1, stdout: JSON.stringify(partial), stderr: 'gh: Could not resolve to a node' })
  const result = host(exec).listDeploys({})
  assert.deepEqual([result[0].state, result[0].url, result[0].statusError], ['success', 'https://l/5', undefined])
  assert.equal(result[1].state, null)
  assert.match(result[1].statusError, /Could not resolve to a node with the global id of N4/)
})

test('listDeploys url is the log url, never the published site (environmentUrl)', () => {
  const { exec } = fakeExec({ stdout: JSON.stringify(depList) }, statusReply({ latestStatus: { state: 'SUCCESS', logUrl: null, environmentUrl: 'https://app' } }, { latestStatus: { state: 'SUCCESS', logUrl: 'https://log', environmentUrl: 'https://app' } }))
  assert.deepEqual(host(exec).listDeploys({}).map((d) => d.url), [null, 'https://log'])
})

test('listDeploys still throws when gh is not logged in or rate limited', () => {
  assert.throws(() => host(fakeExec({ stdout: JSON.stringify(depList) }, { status: 1, stderr: 'Run gh auth login' }).exec).listDeploys({}), (e) => e.code === 'AUTH')
  assert.throws(() => host(fakeExec({ stdout: JSON.stringify(depList) }, { status: 1, stderr: 'API rate limit exceeded' }).exec).listDeploys({}), (e) => e.code === 'RATE_LIMITED')
})

test('listDeploys encodes the environment and checks the limit', () => {
  const { exec, calls } = fakeExec({ stdout: '[]' })
  host(exec).listDeploys({ environment: 'a b&c', limit: 5 })
  assert.deepEqual(calls[0].args, ['api', 'repos/{owner}/{repo}/deployments?per_page=5&environment=a%20b%26c'])
  for (const limit of [0, 101, 1.5, 'x']) {
    assert.throws(() => host(exec).listDeploys({ limit }), (e) => e.code === 'INVALID_INPUT')
  }
  assert.equal(calls.length, 1)
})

test('listDeploys can filter by the ref a deployment was made for', () => {
  const { exec, calls } = fakeExec({ stdout: '[]' })
  host(exec).listDeploys({ ref: 'refs/tags/v1.0', limit: 100 })
  assert.deepEqual(calls[0].args, ['api', 'repos/{owner}/{repo}/deployments?per_page=100&ref=refs%2Ftags%2Fv1.0'])
})

test('ciLogs with a run id reads the failed steps of that run', () => {
  const meta = { workflowName: 'CI', url: 'u99', conclusion: 'failure', status: 'completed', createdAt: '2026-11-01T10:00:00Z', headSha: 'abc' }
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(meta) }, { stdout: 'step failed\n' })
  const result = host(exec).ciLogs({ runId: 99 })
  assert.deepEqual(calls[0].args, ['run', 'view', '99', '--json', 'workflowName,url,conclusion,status,createdAt,headSha'])
  assert.deepEqual(calls[1].args, ['run', 'view', '99', '--log-failed'])
  assert.deepEqual(result, { runId: 99, workflowName: 'CI', url: 'u99', conclusion: 'failure', status: 'completed', createdAt: '2026-11-01T10:00:00Z', headSha: 'abc', log: 'step failed\n' })
})

test('ciLogs with a run id skips the log of a run that did not fail or never started', () => {
  for (const conclusion of ['success', 'startup_failure', null]) {
    const meta = { workflowName: 'CI', url: 'u', conclusion, status: conclusion === null ? 'in_progress' : 'completed' }
    const { exec, calls } = fakeExec({ stdout: JSON.stringify(meta) })
    const result = host(exec).ciLogs({ runId: 5 })
    assert.equal(result.log, '')
    assert.equal(result.conclusion, conclusion)
    assert.equal(calls.length, 1)
  }
})

const wf = (databaseId, conclusion, createdAt, extra = {}) => ({ databaseId, workflowName: 'CI', conclusion, status: conclusion === null ? 'in_progress' : 'completed', url: `u${databaseId}`, createdAt, headSha: `sha${databaseId}`, ...extra })

test('ciLogs without a run id takes the newest failed run of the branch, with its age', () => {
  const runs = [wf(2, 'failure', '2026-11-02T10:00:00Z'), wf(1, 'failure', '2026-11-01T10:00:00Z')]
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(runs) }, { stdout: 'boom\n' })
  const result = host(exec).ciLogs({ branch: 'main' })
  assert.deepEqual(calls[1].args, ['run', 'view', '2', '--log-failed'])
  assert.deepEqual(result, { runId: 2, workflowName: 'CI', url: 'u2', conclusion: 'failure', status: 'completed', createdAt: '2026-11-02T10:00:00Z', headSha: 'sha2', newerRun: null, log: 'boom\n' })
})

test('ciLogs names the newer run of the same workflow that did not fail', () => {
  const runs = [wf(4, null, '2026-11-04T10:00:00Z'), wf(3, 'success', '2026-11-03T10:00:00Z'), wf(2, 'failure', '2026-11-02T10:00:00Z'), wf(9, 'success', '2026-11-05T10:00:00Z', { workflowName: 'Lint' })]
  const { exec } = fakeExec({ stdout: JSON.stringify(runs) }, { stdout: 'boom\n' })
  const result = host(exec).ciLogs({ branch: 'main' })
  assert.equal(result.runId, 2)
  assert.deepEqual(result.newerRun, { runId: 3, conclusion: 'success', createdAt: '2026-11-03T10:00:00Z', headSha: 'sha3' })
})

test('ciLogs does not count a newer cancelled or skipped run as a sign the failure is fixed', () => {
  const runs = [wf(5, 'cancelled', '2026-11-05T10:00:00Z'), wf(4, 'skipped', '2026-11-04T10:00:00Z'), wf(3, 'action_required', '2026-11-03T10:00:00Z'), wf(2, 'failure', '2026-11-02T10:00:00Z')]
  const { exec } = fakeExec({ stdout: JSON.stringify(runs) }, { stdout: 'boom\n' })
  assert.equal(host(exec).ciLogs({ branch: 'main' }).newerRun, null)
})

test('ciLogs names the newest successful run even when a newer one was cancelled', () => {
  const runs = [wf(5, 'cancelled', '2026-11-05T10:00:00Z'), wf(4, 'success', '2026-11-04T10:00:00Z'), wf(2, 'failure', '2026-11-02T10:00:00Z')]
  const { exec } = fakeExec({ stdout: JSON.stringify(runs) }, { stdout: 'boom\n' })
  assert.equal(host(exec).ciLogs({ branch: 'main' }).newerRun.runId, 4)
})

test('ciLogs has no newerRun when the newer runs are still going', () => {
  const runs = [wf(3, null, '2026-11-03T10:00:00Z'), wf(2, 'failure', '2026-11-02T10:00:00Z')]
  const { exec } = fakeExec({ stdout: JSON.stringify(runs) }, { stdout: 'boom\n' })
  assert.equal(host(exec).ciLogs({ branch: 'main' }).newerRun, null)
})

test('ciLogs counts timed_out and startup_failure runs as failed', () => {
  for (const conclusion of ['timed_out', 'startup_failure']) {
    const { exec, calls } = fakeExec({ stdout: JSON.stringify([{ databaseId: 7, workflowName: 'CI', conclusion, url: 'u' }]) }, { stdout: 'x' })
    assert.equal(host(exec).ciLogs({ branch: 'main' }).runId, 7)
    if (conclusion === 'startup_failure') assert.equal(calls.length, 1)
    else assert.deepEqual(calls[1].args, ['run', 'view', '7', '--log-failed'])
  }
})

test('ciLogs with a run id still reads the log of a cancelled, action_required, stale or skipped run', () => {
  for (const conclusion of ['cancelled', 'action_required', 'stale', 'skipped']) {
    const meta = { workflowName: 'CI', url: 'u', conclusion, status: 'completed' }
    const { exec, calls } = fakeExec({ stdout: JSON.stringify(meta) }, { stdout: 'step failed\n' })
    const result = host(exec).ciLogs({ runId: 5 })
    assert.deepEqual(calls[1].args, ['run', 'view', '5', '--log-failed'])
    assert.equal(result.log, 'step failed\n')
  }
})

test('a log that overflows the buffer becomes an UPSTREAM error', () => {
  const { exec } = fakeExec(() => { throw Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' }) })
  assert.throws(() => host(exec).ciLogs({ runId: 9 }), (e) => e instanceof PmkitError && e.code === 'UPSTREAM' && /too large/.test(e.message))
})

test('the default exec reads more than 1 MiB of output', () => {
  const run = defaultExec({ root: process.cwd(), env: process.env })
  const result = run(process.execPath, ['-e', "process.stdout.write('x'.repeat(3 * 1024 * 1024))"])
  assert.equal(result.stdout.length, 3 * 1024 * 1024)
})

test('ciLogs returns null when no run of the branch failed, and refuses bad input', () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify([{ databaseId: 3, conclusion: 'success' }]) })
  assert.equal(host(exec).ciLogs({ branch: 'main' }), null)
  const before = calls.length
  assert.throws(() => host(exec).ciLogs({ branch: '-x' }), (e) => e.code === 'INVALID_INPUT')
  assert.throws(() => host(exec).ciLogs({ runId: 'abc' }), (e) => e.code === 'INVALID_INPUT')
  assert.throws(() => host(exec).ciLogs({}), (e) => e.code === 'INVALID_INPUT')
  assert.equal(calls.length, before)
})

/** An exec that answers by the joined arguments. A call with no entry fails with status 1. */
function mapExec(answers) {
  const calls = []
  const exec = (cmd, args, options = {}) => {
    calls.push({ cmd, args, ...options })
    const answer = answers[args.join(' ')]
    return { status: answer ? 0 : 1, stdout: '', stderr: '', ...answer }
  }
  return { exec, calls }
}

test('prDiff calls gh pr diff without color and returns the text', () => {
  const { exec, calls } = fakeExec({ stdout: 'diff --git a/x b/x\n' })
  assert.equal(host(exec).prDiff(7), 'diff --git a/x b/x\n')
  assert.deepEqual(calls[0].args, ['pr', 'diff', '7', '--color', 'never'])
  assert.throws(() => host(exec).prDiff('x'), (e) => e.code === 'INVALID_INPUT')
  assert.equal(calls.length, 1)
})

test('prDiff returns null when GitHub refuses a diff over its limit (HTTP 406)', () => {
  const stderr = 'could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000)\n'
  assert.equal(host(fakeExec({ status: 1, stderr }).exec).prDiff(7), null)
  assert.throws(() => host(fakeExec({ status: 1, stderr: 'boom\n' }).exec).prDiff(7), (e) => e.code === 'UPSTREAM')
})

test('only the diff reads get a timeout, and the push does not', () => {
  const { exec, calls } = fakeExec({}, { stdout: 'd' }, { status: 0 }, { status: 0 }, { stdout: 'b\n' }, { stdout: 'mb\n' }, { stdout: 'd' })
  const h = host(exec)
  h.push('feat/x')
  h.prDiff(7)
  assert.equal(calls[0].timeout, undefined, 'git push')
  assert.ok(calls[1].timeout >= 1000, 'gh pr diff')
  h.localDiff({ branch: 'feat/x', base: 'main' })
  assert.ok(calls.slice(2).every((c) => c.timeout >= 1000), 'every call of localDiff')
})

test('the default exec passes a per-call timeout, none by default, and the host reports UPSTREAM when it fires', () => {
  const run = defaultExec({ root: process.cwd(), env: process.env })
  assert.throws(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 100 }), (e) => e.code === 'ETIMEDOUT')
  assert.equal(run(process.execPath, ['-e', 'setTimeout(() => process.stdout.write("ok"), 300)']).stdout, 'ok')
  const { exec } = fakeExec(() => { throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
  assert.throws(() => host(exec).prDiff(1), (e) => e.code === 'UPSTREAM' && /timed out/.test(e.message))
})

test('an output that overflows the buffer is UPSTREAM with a message that fits a diff and a log', () => {
  const { exec } = fakeExec(() => { throw Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' }) })
  assert.throws(() => host(exec).prDiff(9), (e) => e.code === 'UPSTREAM' && /too large/.test(e.message) && !/log/i.test(e.message) && !/log/i.test(e.nextStep))
})

const REFS = 'rev-parse --verify --quiet'
const STATUS = '--no-optional-locks status --porcelain --untracked-files=all'

test('localDiff of a branch that is not checked out diffs origin/<base> with the branch', () => {
  const { exec, calls } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/heads/feat/x`]: {}, 'branch --show-current': { stdout: 'other\n' },
    'diff --no-color origin/main...feat/x': { stdout: 'local diff\n' },
  })
  const result = host(exec).localDiff({ branch: 'feat/x', base: 'main' })
  assert.deepEqual(result, { diff: 'local diff\n', base: 'origin/main', ref: 'feat/x', uncommitted: false, untracked: 0, committedEmpty: false, treeError: null })
  assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]).at(-1), ['git', 'diff', '--no-color', 'origin/main...feat/x'])
})

test('localDiff prefers origin/<base> and uses the local base only when there is no remote one', () => {
  const answers = { [`${REFS} refs/heads/develop`]: {}, [`${REFS} refs/heads/feat/x`]: {}, 'branch --show-current': { stdout: 'other\n' } }
  const both = mapExec({ ...answers, [`${REFS} refs/remotes/origin/develop`]: {}, 'diff --no-color origin/develop...feat/x': { stdout: 'remote\n' } })
  assert.equal(host(both.exec).localDiff({ branch: 'feat/x', base: 'develop' }).diff, 'remote\n')
  const localOnly = mapExec({ ...answers, 'diff --no-color develop...feat/x': { stdout: 'local\n' } })
  assert.deepEqual(host(localOnly.exec).localDiff({ branch: 'feat/x', base: 'develop' }), { diff: 'local\n', base: 'develop', ref: 'feat/x', uncommitted: false, untracked: 0, committedEmpty: false, treeError: null })
})

test('localDiff of the checked out branch includes the commits, the index and the working tree', () => {
  const { exec, calls } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/heads/feat/x`]: {}, 'branch --show-current': { stdout: 'feat/x\n' },
    [STATUS]: { stdout: ' M a.txt\n?? new.txt\n' }, 'diff --quiet origin/main...feat/x': { status: 1 },
    'merge-base origin/main feat/x': { stdout: 'abc123\n' }, 'diff --no-color abc123': { stdout: 'all changes\n' },
  })
  assert.deepEqual(host(exec).localDiff({ branch: 'feat/x', base: 'main' }), { diff: 'all changes\n', base: 'origin/main', ref: 'feat/x', uncommitted: true, untracked: 1, committedEmpty: false, treeError: null })
  assert.deepEqual(calls.map((c) => c.args.join(' ')).slice(-3), ['merge-base origin/main feat/x', 'diff --quiet origin/main...feat/x', 'diff --no-color abc123'])
})

test('localDiff uses origin/<branch> when the branch exists only on origin, and never adds the working tree', () => {
  const { exec } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/remotes/origin/feat/x`]: {},
    'diff --no-color origin/main...origin/feat/x': { stdout: 'remote branch\n' },
  })
  assert.deepEqual(host(exec).localDiff({ branch: 'feat/x', base: 'main' }), { diff: 'remote branch\n', base: 'origin/main', ref: 'origin/feat/x', uncommitted: false, untracked: 0, committedEmpty: false, treeError: null })
})

test('localDiff names the missing base or branch', () => {
  const noBase = mapExec({})
  assert.throws(() => host(noBase.exec).localDiff({ branch: 'x', base: 'develop' }), (e) => e.code === 'INVALID_INPUT' && /develop/.test(e.message))
  const noBranch = mapExec({ [`${REFS} refs/remotes/origin/main`]: {} })
  assert.throws(() => host(noBranch.exec).localDiff({ branch: 'gone', base: 'main' }), (e) => e.code === 'INVALID_INPUT' && /gone/.test(e.message))
})

test('localDiff refuses a branch or base that starts with a dash before git runs', () => {
  const { exec, calls } = fakeExec()
  for (const args of [{ branch: '-x', base: 'main' }, { branch: 'x', base: '--output=f' }, { branch: '', base: 'main' }]) {
    assert.throws(() => host(exec).localDiff(args), (e) => e.code === 'INVALID_INPUT')
  }
  assert.equal(calls.length, 0)
})

test('unpushedCommits counts the commits of a local branch that origin lacks, and is null without an origin branch', () => {
  const answers = { [`${REFS} refs/heads/feat/x`]: {}, [`${REFS} refs/remotes/origin/feat/x`]: {}, 'rev-list --count origin/feat/x..feat/x': { stdout: '2\n' } }
  assert.equal(host(mapExec(answers).exec).unpushedCommits('feat/x'), 2)
  assert.equal(host(mapExec({ [`${REFS} refs/heads/feat/x`]: {} }).exec).unpushedCommits('feat/x'), null)
  assert.equal(host(mapExec({}).exec).unpushedCommits('feat/x'), null)
})


test('prMergeState reads the merge fields with gh pr view', () => {
  const state = { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: 'REVIEW_REQUIRED', baseRefName: 'main' }
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(state) })
  assert.deepEqual(host(exec).prMergeState(12), state)
  assert.deepEqual(calls[0].args, ['pr', 'view', '12', '--json', 'mergeable,mergeStateStatus,reviewDecision,baseRefName'])
})

test('prThreads asks the review threads with one graphql call, flattens them and reports a second page', () => {
  const node = (id, extra = {}) => ({ isResolved: false, isOutdated: false, path: 'a.js', line: 3, comments: { nodes: [{ url: `https://x/${id}`, body: `c${id}`, author: { login: 'bob' } }] }, ...extra })
  const reply = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [node(1), node(2, { isResolved: true })] } } } } }
  const { exec, calls } = fakeExec({ stdout: JSON.stringify(reply) })
  const result = host(exec).prThreads(12)
  assert.deepEqual(calls[0].args.slice(0, 2), ['api', 'graphql'])
  for (const part of ['owner={owner}', 'repo={repo}', 'number=12']) assert.ok(calls[0].args.includes(part), part)
  assert.equal(result.incomplete, true)
  assert.deepEqual(result.threads[0], { isResolved: false, isOutdated: false, path: 'a.js', line: 3, url: 'https://x/1', author: 'bob', body: 'c1' })
  assert.equal(result.threads[1].isResolved, true)
})

test('prThreads maps the failed graphql call of gh, with its JSON on stdout and its message on stderr, to UPSTREAM', () => {
  const stdout = JSON.stringify({ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] })
  const { exec } = fakeExec({ status: 1, stdout, stderr: 'gh: Resource not accessible by integration\n' })
  assert.throws(() => host(exec).prThreads(12), (e) => e.code === 'UPSTREAM' && /not accessible/.test(e.message))
})

test('branchProtection reads the protection of the base, returns null when unprotected and UPSTREAM on a refusal', () => {
  const rules = { required_pull_request_reviews: { required_approving_review_count: 2 } }
  const ok = fakeExec({ stdout: JSON.stringify(rules) })
  assert.deepEqual(host(ok.exec).branchProtection('main'), rules)
  assert.deepEqual(ok.calls[0].args, ['api', 'repos/{owner}/{repo}/branches/main/protection'])
  const open = fakeExec({ status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' })
  assert.equal(host(open.exec).branchProtection('main'), null)
  const refused = fakeExec({ status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' })
  assert.throws(() => host(refused.exec).branchProtection('main'), (e) => e.code === 'UPSTREAM')
  const bad = fakeExec()
  assert.throws(() => host(bad.exec).branchProtection('-x'), (e) => e.code === 'INVALID_INPUT')
  assert.equal(bad.calls.length, 0)
})

test('a gh api failure carries the HTTP status of the reply, read from the status marker and not from the free text', () => {
  const status = (stderr) => { try { host(fakeExec({ status: 1, stderr }).exec).branchProtection('fix-404') } catch (e) { return e.httpStatus } }
  assert.equal(status('gh: Resource not accessible by integration (HTTP 403)\n'), 403)
  assert.equal(status('gh: Not Found (HTTP 404)\n'), 404)
  assert.equal(status('HTTP 502: Bad Gateway (https://api.github.com/repos/o/r/branches/fix-404/protection)\n'), 502)
  assert.equal(status('error connecting to api.github.com/repos/o/r/branches/fix-404/protection\n'), undefined)
})

test('prThreads marks a FORBIDDEN or NOT_FOUND graphql error with the matching HTTP status, as the real gh fails it', () => {
  const status = (type) => {
    const stdout = JSON.stringify({ errors: [{ type, message: 'nope' }] })
    try { host(fakeExec({ status: 1, stdout, stderr: 'gh: nope\n' }).exec).prThreads(1) } catch (e) { return e.httpStatus }
  }
  assert.equal(status('FORBIDDEN'), 403)
  assert.equal(status('NOT_FOUND'), 404)
  assert.equal(status('INTERNAL'), undefined)
})

test('a GraphQL: Resource not accessible refusal of gh pr view and gh pr checks is a 403', () => {
  const stderr = 'GraphQL: Resource not accessible by integration (repository.pullRequest.statusCheckRollup)\n'
  const status = (read) => { try { read(host(fakeExec({ status: 1, stderr }).exec)) } catch (e) { return e.httpStatus } }
  assert.equal(status((h) => h.prChecks(1)), 403)
  assert.equal(status((h) => h.prMergeState(1)), 403)
  assert.equal(status((h) => h.prReviews(1)), 403)
  const other = () => { try { host(fakeExec({ status: 1, stderr: 'GraphQL: Could not resolve to a PullRequest\n' }).exec).prMergeState(1) } catch (e) { return e.httpStatus } }
  assert.equal(other(), undefined)
})

test('a SAML enforcement or missing-scopes refusal is a 403, and a message that only mentions them is not', () => {
  const status = (stderr, read = (h) => h.prChecks(1)) => { try { read(host(fakeExec({ status: 1, stderr }).exec)) } catch (e) { return e.httpStatus } }
  assert.equal(status('GraphQL: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.\n'), 403)
  assert.equal(status('gh: Resource protected by organization SAML enforcement.\n', (h) => h.prReviews(1)), 403)
  assert.equal(status('GraphQL: Your token has not been granted the required scopes to execute this query. (INSUFFICIENT_SCOPES)\n', (h) => h.prMergeState(1)), 403)
  assert.equal(status('error: your authentication token is missing required scopes [read:org]\n'), 403)
  assert.equal(status('GraphQL: Could not resolve to a PullRequest with the name SAML enforcement\n'), undefined)
  const threads = (type) => {
    const stdout = JSON.stringify({ errors: [{ type, message: 'nope' }] })
    try { host(fakeExec({ status: 1, stdout, stderr: 'gh: nope\n' }).exec).prThreads(1) } catch (e) { return e.httpStatus }
  }
  assert.equal(threads('INSUFFICIENT_SCOPES'), 403)
})

const onBranch = { 'branch --show-current': { stdout: 'feat/x\n' } }

test('workingTree is null for a branch that is not checked out', () => {
  assert.equal(host(mapExec({ 'branch --show-current': { stdout: 'other\n' } }).exec).workingTree('feat/x'), null)
})

test('workingTree separates tracked changes from untracked files, and a clean tree is neither', () => {
  const tree = (stdout) => host(mapExec({ ...onBranch, [STATUS]: { stdout } }).exec).workingTree('feat/x')
  assert.deepEqual(tree(''), { uncommitted: false, untracked: 0 })
  assert.deepEqual(tree('?? new.txt\n'), { uncommitted: false, untracked: 1 })
  assert.deepEqual(tree(' M a.txt\nA  b.txt\n'), { uncommitted: true, untracked: 0 })
})

test('workingTree throws when git status fails, so an unknown state is never clean', () => {
  assert.throws(() => host(mapExec({ ...onBranch }).exec).workingTree('feat/x'), (e) => e.code === 'UPSTREAM')
})

test('localDiff of a checked out branch with a clean tree is the three-dot diff and not uncommitted', () => {
  const { exec } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/heads/feat/x`]: {}, ...onBranch, [STATUS]: {},
    'diff --no-color origin/main...feat/x': { stdout: 'd\n' },
  })
  assert.deepEqual(host(exec).localDiff({ branch: 'feat/x', base: 'main' }), { diff: 'd\n', base: 'origin/main', ref: 'feat/x', uncommitted: false, untracked: 0, committedEmpty: false, treeError: null })
})

test('branchHas is true when the commit is a tip of the branch or behind one, false when it is not, and null without the branch', () => {
  const tips = { [`${REFS} refs/heads/feat/x`]: { stdout: 'aaa\n' }, [`${REFS} refs/remotes/origin/feat/x`]: { stdout: 'bbb\n' } }
  const has = (oid, answers = {}) => host(mapExec({ ...tips, ...answers }).exec).branchHas('feat/x', () => oid)
  assert.equal(has('aaa'), true, 'the local tip')
  assert.equal(has('bbb'), true, 'the tip of origin')
  assert.equal(has('old', { 'merge-base --is-ancestor old aaa': {} }), true, 'behind the local tip')
  assert.equal(has('other'), false)
  assert.equal(host(mapExec({}).exec).branchHas('feat/x', () => assert.fail('no branch, no commit to read')), null)
})

test('localDiff says when the committed range is empty even though the working tree is not', () => {
  const { exec } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/heads/feat/x`]: {}, ...onBranch, [STATUS]: { stdout: ' M a\n' },
    'merge-base origin/main feat/x': { stdout: 'abc\n' }, 'diff --no-color abc': { stdout: 'wt\n' }, 'diff --quiet origin/main...feat/x': {},
  })
  const result = host(exec).localDiff({ branch: 'feat/x', base: 'main' })
  assert.deepEqual([result.uncommitted, result.committedEmpty, result.diff], [true, true, 'wt\n'])
})

test('localDiff reports an unreadable working tree as treeError and still returns the committed diff', () => {
  const { exec } = mapExec({
    [`${REFS} refs/remotes/origin/main`]: {}, [`${REFS} refs/heads/feat/x`]: {}, ...onBranch,
    'diff --no-color origin/main...feat/x': { stdout: 'd\n' },
  })
  const result = host(exec).localDiff({ branch: 'feat/x', base: 'main' })
  assert.deepEqual([result.diff, result.uncommitted, typeof result.treeError], ['d\n', false, 'string'])
})

test('workingTree counts untracked files one by one, not one per directory', () => {
  const lines = host(mapExec({ ...onBranch, [STATUS]: { stdout: '?? d/a\n?? d/b\n?? c\n' } }).exec).workingTree('feat/x')
  assert.deepEqual(lines, { uncommitted: false, untracked: 3 })
})

test('prRefs reads the base name and the head commit of a pull request', () => {
  const { exec, calls } = fakeExec({ stdout: JSON.stringify({ baseRefName: 'develop', headRefOid: 'abc' }) })
  assert.deepEqual(host(exec).prRefs(7), { baseRefName: 'develop', headRefOid: 'abc' })
  assert.deepEqual(calls[0].args, ['pr', 'view', '7', '--json', 'baseRefName,headRefOid'])
})
