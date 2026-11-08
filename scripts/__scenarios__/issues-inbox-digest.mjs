// /pmkit:issues:inbox-digest on the team fixture with GitHub. Setup: ana assigns ISS-6J0B to fred and mentions him in a comment on it.
// ISS-8C4W (ana, in review) gets a branch whose pull request asks fred for a review, so the digest shows one review waiting.
// The fixture's ISS-3Q6T file has conflict markers, so both reads come back incomplete and the digest must say so.
// Reading only: no event is appended and the user store is not touched, so no mark-read runs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createGithubHost } from '../lib/github/host.mjs'

const BRANCH = 'iss-8c4w-dead-letter-queue'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const pr = { number: 9, url: 'https://github.com/o/r/pull/9', title: 'Dead-letter queue for webhooks (ISS-8C4W)', state: 'OPEN', isDraft: false, headRefName: BRANCH, author: { login: 'ana' }, mergedAt: null }
const threads = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }

/** The argument string of the graphql call, taken from the real host so the canned key cannot drift. */
function threadsKey() {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: JSON.stringify(threads), stderr: '' } } }).prThreads(9)
  return key
}

export default {
  command: 'issues/inbox-digest',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr checks 9 --json name,state,bucket': { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    'pr view 9 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [{ __typename: 'User', login: 'fred' }] }) },
    'pr view 9 --json mergeable,mergeStateStatus,reviewDecision,baseRefName': { stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'REVIEW_REQUIRED', baseRefName: 'main' }) },
    [threadsKey()]: { stdout: JSON.stringify(threads) },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Not Found (HTTP 404)\n' },
  },
  async setup({ pmkit, root }) {
    await pmkit(['issues', 'update', 'ISS-8C4W', '--branch', BRANCH])
    await pmkit(['issues', 'assign', 'ISS-6J0B', 'fred', '--as', 'ana'])
    const body = path.join(root, 'mention.md')
    fs.writeFileSync(body, 'Can you look at this, @fred?\n')
    await pmkit(['issues', 'comment', 'ISS-6J0B', '--body-file', body, '--as', 'ana'])
    fs.rmSync(body)
  },
  prompt: '/pmkit:issues:inbox-digest',
  answers: [],
  steps: [
    { step: '1', read: ['capabilities'] },
    { step: '2', read: ['inbox', 'list'], save: 'inbox' },
    { step: '3', read: ['issues', 'list', '--category', 'in_review'], save: 'review' },
    { step: '3.1', read: ['pr', 'blockers', '--branch', BRANCH], save: 'blockers' },
  ],
  skip: {
    '2 issues list': 'the tracker has user_inbox, so step 2b and its derived list do not run',
  },
  notHit: {},
  expect(repo, saved) {
    assert.deepEqual(repo.newEvents('ISS-6J0B').filter((event) => event.op !== 'assign' && event.op !== 'comment'), [])
    // The fixture holds one issue file with conflict markers (ISS-3Q6T): the digest must call both reads incomplete.
    assert.equal(saved.inbox.complete, false)
    assert.deepEqual(saved.inbox.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.review.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.inbox.items.map((item) => [item.kind, item.issue, item.by]), [['assignment', 'ISS-6J0B', 'ana'], ['mention', 'ISS-6J0B', 'ana']])
    assert.deepEqual(saved.review.issues.map((issue) => issue.id), ['ISS-8C4W'])
    assert.deepEqual(saved.blockers.reviews.requested, ['fred'])
    assert.deepEqual(saved.blockers.unchecked.map((u) => u.area), ['policies'])
  },
}
