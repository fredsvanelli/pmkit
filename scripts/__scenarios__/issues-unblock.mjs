// /pmkit:issues:unblock ISS-5N1R on the team fixture, with GitHub. ISS-5N1R gets the branch below in setup. gh answers that
// the branch has the open draft pull request #7 with a failing check, a requested reviewer, merge conflicts and one open thread.
// Reading the branch protection is refused, so the policies come back as not checked. The user confirms marking the draft ready.
import assert from 'node:assert/strict'
import { createGithubHost } from '../lib/github/host.mjs'

const BRANCH = 'iss-5n1r-paginate-the-events-api'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const pr = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN',
  isDraft: true, headRefName: BRANCH, author: { login: 'fred' }, mergedAt: null,
}
const threads = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [
  { isResolved: false, isOutdated: false, path: 'src/events.mjs', line: 2, comments: { nodes: [{ url: 'https://github.com/o/r/pull/7#discussion_r1', body: 'Name the cursor', author: { login: 'ana' } }] } },
] } } } } }

/** The argument string of the graphql call, taken from the real host so the canned key cannot drift. */
function threadsKey() {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: JSON.stringify(threads), stderr: '' } } }).prThreads(7)
  return key
}

export default {
  command: 'issues/unblock',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 7 --json name,state,bucket': { status: 8, stdout: JSON.stringify([{ name: 'test', state: 'FAILURE', bucket: 'fail' }, { name: 'lint', state: 'SUCCESS', bucket: 'pass' }]) },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [{ __typename: 'User', login: 'ana' }] }) },
    'pr view 7 --json mergeable,mergeStateStatus,reviewDecision,baseRefName': { stdout: JSON.stringify({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', reviewDecision: 'REVIEW_REQUIRED', baseRefName: 'main' }) },
    [threadsKey()]: { stdout: JSON.stringify(threads) },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' },
    'pr ready 7': { stdout: '' },
    [`pr view 7 --json ${VIEW}`]: { stdout: JSON.stringify({ ...pr, isDraft: false }) },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--branch', BRANCH])
  },
  prompt: '/pmkit:issues:unblock ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '2', read: ['pr', 'blockers', '--branch', BRANCH], save: 'blockers' },
    { confirm: 'Step 5' },
    { step: '5', dryRun: ['pr', 'ready', '--issue', 'ISS-5N1R'] },
    { step: '5', write: ['pr', 'ready', '--issue', 'ISS-5N1R'] },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    const { blockers } = saved
    assert.deepEqual(repo.newEvents('ISS-5N1R').filter((event) => event.op !== 'update'), [], 'a read-only command appends no event')
    assert.equal(blockers.blocked, true)
    assert.equal(blockers.draft, true)
    assert.ok(repo.ghCalls().includes('pr ready 7'), 'the user confirmed, so the pull request is marked ready')
    assert.deepEqual(blockers.checks.failing.map((c) => c.name), ['test'])
    assert.deepEqual(blockers.reviews.requested, ['ana'])
    assert.equal(blockers.conflicts.conflicting, true)
    assert.equal(blockers.threads.open.length, 1)
    assert.equal(blockers.policies, null)
    assert.deepEqual(blockers.unchecked.map((u) => u.area), ['policies'])
  },
}
