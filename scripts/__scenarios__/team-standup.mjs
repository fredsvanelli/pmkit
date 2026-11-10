// /pmkit:team:standup me on the team fixture with the GitHub host. ISS-8C4W (in review) has a branch with an open PR,
// so the pr sync preview moves nothing and step 1 never asks.
import assert from 'node:assert/strict'
import { createGithubHost } from '../lib/github/host.mjs'

// pr status reads the pull request with its reviews and merge state, then the blocker reads (threads, protection, rules).
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt,reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName'
const pr = { number: 9, url: 'https://github.com/o/r/pull/9', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'OPEN', isDraft: false, headRefName: 'feat-dlq', author: { login: 'ana' }, mergedAt: null,
  reviews: [], reviewRequests: [{ login: 'fred' }], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' }
const NO_THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } })

/** The argument string of the first graphql call of the threads, taken from the real host so the canned key cannot drift. */
function threadsKey(number) {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: NO_THREADS, stderr: '' } } }).prThreads(number)
  return key
}

export default {
  command: 'team/standup',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view feat-dlq --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 9 --json name,state,bucket,link': { stdout: JSON.stringify([{ name: 'test', state: 'FAILURE', bucket: 'fail' }]) },
    [threadsKey(9)]: { stdout: NO_THREADS },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' },
    'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { stdout: '[]' },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', 'feat-dlq'])
  },
  prompt: '/pmkit:team:standup me',
  answers: [],
  steps: [
    { step: '1', dryRun: ['pr', 'sync'], save: 'sync' },
    { step: '2', read: ['events', '--since', '2026-10-22'], save: 'events' },
    { step: '3', read: ['issues', 'list', '--category', 'in_progress,in_review,todo'], save: 'open' },
    { step: '3', read: ['events', '--since', '2026-10-20'] },
    { step: '4', read: ['pr', 'status', '--branch', 'feat-dlq'], save: 'status' },
    { step: '5', read: ['whoami'], save: 'me' },
  ],
  skip: {},
  notHit: { 'Step 1': 'no in_review issue has a merged PR, so the pr sync preview moves nothing and does not ask' },
  expect(repo, saved) {
    assert.deepEqual(repo.newEvents('ISS-8C4W'), [], 'a read-only command appends no event')
    assert.ok(repo.ghCalls().includes('pr checks 9 --json name,state,bucket,link'), repo.ghCalls().join('\n'))
    assert.deepEqual(saved.sync.moved, [])
    assert.equal(saved.me.id, 'fred')
    assert.ok(saved.open.issues.some((issue) => issue.id === 'ISS-8C4W' && issue.branch === 'feat-dlq'))
    assert.ok(saved.events.every((event) => event.at >= '2026-10-22'), 'the digest period starts on 2026-10-22')
    assert.deepEqual(saved.status.checks.map((check) => check.bucket), ['fail'], 'the failing check goes to needs attention')
  },
}
