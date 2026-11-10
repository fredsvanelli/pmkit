// /pmkit:issues:mine on the team fixture with the GitHub host. ISS-5N1R (fred, in progress) has a branch with an open PR.
// No issue is in review with a merged PR, so the pr sync preview moves nothing and step 1 never asks.
// A ruleset on main requires two approvals and the PR has one, so pr status says it is blocked and the PR column shows why.
import assert from 'node:assert/strict'
import { createGithubHost } from '../lib/github/host.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt,reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName'
const pr = { number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN', isDraft: false, headRefName: 'feat-retries', author: { login: 'fred' }, mergedAt: null,
  reviews: [{ author: { login: 'ana' }, state: 'APPROVED' }], reviewRequests: [], mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', baseRefName: 'main' }
const NO_THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } })

/** The argument string of the first graphql call of the threads, taken from the real host so the canned key cannot drift. */
function threadsKey(number) {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: NO_THREADS, stderr: '' } } }).prThreads(number)
  return key
}

export default {
  command: 'issues/mine',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view feat-retries --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 7 --json name,state,bucket,link': { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    [threadsKey(7)]: { stdout: NO_THREADS },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' },
    'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { stdout: JSON.stringify([{ type: 'pull_request', parameters: { required_approving_review_count: 2 } }]) },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--branch', 'feat-retries'])
  },
  prompt: '/pmkit:issues:mine',
  answers: [],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'], save: 'sync' },
    { step: '2', read: ['cycle', 'current'] },
    { step: '3', read: ['issues', 'list', '--assignee', 'me', '--sprint', 'current'], save: 'mine' },
    { step: '5', read: ['pr', 'status', '--branch', 'feat-retries'], save: 'status' },
  ],
  skip: { '3 issues list': 'the fixture has an active sprint, so step 3 does not fall back to the list of all assigned issues' },
  notHit: { 'Step 1': 'no in_review issue has a merged PR, so the pr sync preview moves nothing and does not ask' },
  expect(repo, saved) {
    assert.deepEqual(repo.newEvents('ISS-5N1R'), [], 'a read-only command appends no event')
    assert.ok(repo.ghCalls().includes(`pr view feat-retries --json ${VIEW}`), repo.ghCalls().join('\n'))
    assert.ok(repo.ghCalls().includes('pr checks 7 --json name,state,bucket,link'))
    assert.deepEqual(saved.sync.moved, [])
    const mine = saved.mine.issues.find((issue) => issue.id === 'ISS-5N1R')
    assert.equal(mine.branch, 'feat-retries')
    assert.equal(saved.status.pr.number, 7)
    assert.deepEqual(saved.status.checks.map((check) => check.bucket), ['pass'])
    assert.deepEqual(saved.status.reviews.map((review) => review.state), ['APPROVED'])
    // The PR column of step 5 shows the verdict: blocked, with the ruleset's approval count.
    assert.equal(saved.status.blockers.blocked, true)
    assert.deepEqual(saved.status.blockers.blocking.map((b) => b.message), ['needs 1 more approval (1 of 2)'])
  },
}
