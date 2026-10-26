// /pmkit:team:standup me on the team fixture with the GitHub host. ISS-8C4W (in review) has a branch with an open PR,
// so the pr sync preview moves nothing and step 1 never asks.
import assert from 'node:assert/strict'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const pr = { number: 9, url: 'https://github.com/o/r/pull/9', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'OPEN', isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: null }

export default {
  command: 'team/standup',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 9 --json name,state,bucket': { stdout: JSON.stringify([{ name: 'test', state: 'FAILURE', bucket: 'fail' }]) },
    'pr view 9 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [{ login: 'fred' }] }) },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
  },
  prompt: '/pmkit:team:standup me',
  answers: [],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'] },
    { step: '2', read: ['events', '--since', '2026-10-22'] },
    { step: '3', read: ['issues', 'list', '--category', 'in_progress,in_review,todo'] },
    { step: '3', read: ['events', '--since', '2026-10-20'] },
    { step: '4', read: ['pr', 'status', '--branch', 'feat-dlq'] },
    { step: '5', read: ['whoami'] },
  ],
  skip: {},
  notHit: { 'Step 1': 'no in_review issue has a merged PR, so the pr sync preview moves nothing and does not ask' },
  expect(repo) {
    assert.deepEqual(repo.newEvents('ISS-8C4W'), [], 'a read-only command appends no event')
    assert.ok(repo.ghCalls().includes('pr checks 9 --json name,state,bucket'), repo.ghCalls().join('\n'))
  },
}
