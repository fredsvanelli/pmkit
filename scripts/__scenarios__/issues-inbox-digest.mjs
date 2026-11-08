// /pmkit:issues:inbox-digest on the team fixture with GitHub. Setup: ana assigns ISS-6J0B to fred and mentions him in a comment on it.
// The fixture's ISS-3Q6T file has conflict markers, so both reads come back incomplete and the digest must say so.
// Reading only: no event is appended and the user store is not touched, so no mark-read runs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createGithubHost } from '../lib/github/host.mjs'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const NO_THREADS = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } }
// 100 threads were read and all are resolved, and GitHub says there are more: the open one, if any, was not read.
const CUT_THREADS = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: true }, nodes: [
  { isResolved: true, isOutdated: false, path: 'a.mjs', line: 1, comments: { nodes: [{ url: 'https://github.com/o/r/pull/10#r1', body: 'ok', author: { login: 'ana' } }] } },
] } } } } }

/** The argument string of the graphql call, taken from the real host so the canned key cannot drift. */
function threadsKey(number, threads) {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: JSON.stringify(threads), stderr: '' } } }).prThreads(number)
  return key
}

/** The gh answers of an open pull request on main. `requested` are the review requests; the protection read is refused with 404. */
function openPr({ number, branch, author = 'ana', requested = [], threads = NO_THREADS }) {
  const pr = { number, url: `https://github.com/o/r/pull/${number}`, title: `Work on ${branch}`, state: 'OPEN', isDraft: false, headRefName: branch, author: { login: author }, mergedAt: null }
  return {
    [`pr view ${branch} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    [`pr checks ${number} --json name,state,bucket`]: { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    [`pr view ${number} --json reviews,reviewRequests`]: { stdout: JSON.stringify({ reviews: [], reviewRequests: requested.map((login) => ({ __typename: 'User', login })) }) },
    [`pr view ${number} --json mergeable,mergeStateStatus,reviewDecision,baseRefName`]: { stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' }) },
    [threadsKey(number, threads)]: { stdout: JSON.stringify(threads) },
  }
}

// ISS-8C4W (ana): open PR 9 asks fred for a review.
// ISS-4M2S (fred): open PR 10 whose thread read is cut (B1).
// ISS-3F7H (nobody): open PR 11 asks fred for a review and the protection read is refused, so `blocked` is null (B2, B4).
// ISS-2X6D (ana): PR 12 is merged (B3).
// ISS-1V9Z (nobody): in review with no branch recorded (N6).
const B = { review: 'iss-8c4w-dead-letter-queue', cut: 'iss-4m2s-csv-column-order', nobody: 'iss-3f7h-empty-state', merged: 'iss-2x6d-billing-export' }
const merged = { number: 12, url: 'https://github.com/o/r/pull/12', title: 'Billing export (ISS-2X6D)', state: 'MERGED', isDraft: false, headRefName: B.merged, author: { login: 'ana' }, mergedAt: '2026-10-30T10:00:00Z' }

export default {
  command: 'issues/inbox-digest',
  fixture: 'team',
  github: true,
  gh: {
    ...openPr({ number: 9, branch: B.review, requested: ['fred'] }),
    ...openPr({ number: 10, branch: B.cut, author: 'fred', threads: CUT_THREADS }),
    ...openPr({ number: 11, branch: B.nobody, requested: ['fred'] }),
    [`pr view ${B.merged} --json ${VIEW}`]: { stdout: JSON.stringify(merged) },
    'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Not Found (HTTP 404)\n' },
  },
  async setup({ pmkit, root }) {
    for (const [id, branch] of [['ISS-8C4W', B.review], ['ISS-4M2S', B.cut], ['ISS-3F7H', B.nobody], ['ISS-2X6D', B.merged]]) await pmkit(['issues', 'update', id, '--branch', branch])
    for (const id of ['ISS-4M2S', 'ISS-3F7H', 'ISS-2X6D', 'ISS-1V9Z']) await pmkit(['issues', 'move', id, 'in_review'])
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
    { step: '4', read: ['whoami'], save: 'me' },
    { step: '5', read: ['issues', 'list', '--category', 'in_review'], save: 'review' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.review], save: 'requested' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.cut], save: 'cut' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.nobody], save: 'nobody' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.merged], save: 'mergedPr' },
  ],
  skip: {
    '3 issues list': 'the tracker has user_inbox, so step 3 and its derived list do not run',
  },
  notHit: {},
  expect(repo, saved) {
    assert.deepEqual(repo.newEvents('ISS-6J0B').filter((event) => event.op !== 'assign' && event.op !== 'comment'), [])
    // The fixture holds one issue file with conflict markers (ISS-3Q6T): the digest must call both reads incomplete.
    assert.equal(saved.inbox.complete, false)
    assert.deepEqual(saved.inbox.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.review.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.inbox.items.map((item) => [item.kind, item.issue, item.by]), [['assignment', 'ISS-6J0B', 'ana'], ['mention', 'ISS-6J0B', 'ana']])
    assert.equal(saved.me.id, 'fred')
    // Five issues are in review; the one with no branch has no pr blockers call (step 5.2, no branch recorded).
    assert.deepEqual(saved.review.issues.map((issue) => [issue.id, issue.assignee ?? null, issue.branch ?? null]).sort(), [
      ['ISS-1V9Z', null, null], ['ISS-2X6D', 'ana', B.merged], ['ISS-3F7H', null, B.nobody], ['ISS-4M2S', 'fred', B.cut], ['ISS-8C4W', 'ana', B.review],
    ])
    assert.deepEqual(saved.requested.reviews.requested, ['fred'])
    // B1: the thread read is cut and shows no open thread, so the digest says not verified.
    assert.equal(saved.cut.threads.incomplete, true)
    assert.deepEqual(saved.cut.threads.open, [])
    // B2 and B4: an unassigned open PR with an unread protection has blocked null and still asks fred for a review.
    assert.equal(saved.nobody.blocked, null)
    assert.ok(saved.nobody.pr)
    assert.deepEqual(saved.nobody.reviews.requested, ['fred'])
    assert.deepEqual(saved.nobody.unchecked.map((u) => u.area), ['policies'])
    // B3: a merged PR has no reviews or threads and nothing unchecked.
    assert.equal(saved.mergedPr.pr.state, 'MERGED')
    assert.equal(saved.mergedPr.reviews, null)
    assert.equal(saved.mergedPr.threads, null)
    assert.deepEqual(saved.mergedPr.unchecked, [])
  },
}
