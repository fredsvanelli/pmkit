// /pmkit:issues:mine on the team fixture with the GitHub host. ISS-5N1R (fred, in progress) has a branch with an open PR.
// No issue is in review with a merged PR, so the pr sync preview moves nothing and step 1 never asks.
import assert from 'node:assert/strict'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const pr = { number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN', isDraft: false, headRefName: 'feat-retries', author: { login: 'fred' }, mergedAt: null }

export default {
  command: 'issues/mine',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view feat-retries --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 7 --json name,state,bucket': { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [{ state: 'APPROVED' }], reviewRequests: [] }) },
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
    assert.deepEqual(saved.sync.moved, [])
    const mine = saved.mine.issues.find((issue) => issue.id === 'ISS-5N1R')
    assert.equal(mine.branch, 'feat-retries')
    assert.equal(saved.status.pr.number, 7)
    assert.deepEqual(saved.status.checks.map((check) => check.bucket), ['pass'])
    assert.deepEqual(saved.status.reviews.map((review) => review.state), ['APPROVED'])
    assert.deepEqual(repo.newEvents('ISS-5N1R'), [], 'a read-only command appends no event')
    assert.ok(repo.ghCalls().includes(`pr view feat-retries --json ${VIEW}`), repo.ghCalls().join('\n'))
    assert.ok(repo.ghCalls().includes('pr checks 7 --json name,state,bucket'))
  },
}
