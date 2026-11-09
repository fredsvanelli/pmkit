// /pmkit:issues:inbox-digest on the team fixture with GitHub. Setup: ana assigns ISS-6J0B to fred and mentions him in a comment on it.
// The fixture's ISS-3Q6T file has conflict markers, so both reads come back incomplete and the digest must say so.
// Reading only: no event is appended and the user store is not touched, so no mark-read runs.
// Three entries: `all` (reviews of every status and assignee, a team request, the stale conflict file), `complete` (the
// conflict file is gone, so the inbox is complete and the digest offers mark-read with the shown keys) and `rateLimited`
// (the first pull request read is refused with RATE_LIMITED, so the digest stops and says reviews are incomplete).
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
function openPr({ number, branch, author = 'ana', requested = [], teams = [], threads = NO_THREADS }) {
  const pr = { number, url: `https://github.com/o/r/pull/${number}`, title: `Work on ${branch}`, state: 'OPEN', isDraft: false, headRefName: branch, author: { login: author }, mergedAt: null }
  return {
    [`pr view ${branch} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    [`pr checks ${number} --json name,state,bucket`]: { stdout: JSON.stringify([{ name: 'test', state: 'SUCCESS', bucket: 'pass' }]) },
    [`pr view ${number} --json reviews,reviewRequests`]: { stdout: JSON.stringify({ reviews: [], reviewRequests: [...requested.map((login) => ({ __typename: 'User', login })), ...teams.map((slug) => ({ __typename: 'Team', name: slug, slug }))] }) },
    [`pr view ${number} --json mergeable,mergeStateStatus,reviewDecision,baseRefName`]: { stdout: JSON.stringify({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' }) },
    [threadsKey(number, threads)]: { stdout: JSON.stringify(threads) },
  }
}

// ISS-8C4W (ana): open PR 9 asks fred for a review.
// ISS-4M2S (ana, in_progress): open PR 10 written by fred, whose thread read is cut (B1) and which asks a team called `fred` for a review.
//   The issue is not fred's and not in review: the pull request is found by its author, and the team never matches fred.
// ISS-3F7H (nobody, in_progress): open PR 11 asks fred for a review and the protection read is refused, so `blocked` is null (B2, B4).
// ISS-2X6D (ana): PR 12 is merged (B3).
// ISS-1V9Z (nobody): in review with no branch recorded (N6).
const B = { review: 'iss-8c4w-dead-letter-queue', cut: 'iss-4m2s-csv-column-order', nobody: 'iss-3f7h-empty-state', merged: 'iss-2x6d-billing-export' }
const merged = { number: 12, url: 'https://github.com/o/r/pull/12', title: 'Billing export (ISS-2X6D)', state: 'MERGED', isDraft: false, headRefName: B.merged, author: { login: 'ana' }, mergedAt: '2026-10-30T10:00:00Z' }

const LIST = ['issues', 'list', '--category', 'backlog,todo,in_progress,in_review']
const BRANCHES = [['ISS-8C4W', B.review], ['ISS-4M2S', B.cut], ['ISS-3F7H', B.nobody], ['ISS-2X6D', B.merged]]

async function setup({ pmkit, root }) {
  for (const [id, branch] of BRANCHES) await pmkit(['issues', 'update', id, '--branch', branch])
  for (const id of ['ISS-2X6D', 'ISS-1V9Z']) await pmkit(['issues', 'move', id, 'in_review'])
  // Not in review: the digest finds their pull requests whatever the status. ISS-4M2S also leaves fred, who keeps the PR as its author.
  for (const id of ['ISS-4M2S', 'ISS-3F7H']) await pmkit(['issues', 'move', id, 'in_progress'])
  await pmkit(['issues', 'assign', 'ISS-4M2S', 'ana'])
  await pmkit(['issues', 'assign', 'ISS-6J0B', 'fred', '--as', 'ana'])
  const body = path.join(root, 'mention.md')
  fs.writeFileSync(body, 'Can you look at this, @fred?\n')
  await pmkit(['issues', 'comment', 'ISS-6J0B', '--body-file', body, '--as', 'ana'])
  fs.rmSync(body)
  // An older mention (before the 14 day window of the first list): the list hides it and counts it in `hidden`.
  const old = path.join(root, '.issues', 'issues', 'ISS-5N1R', 'comments')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, '2026-09-20T12-00-00Z-ana.md'), '---\nauthor: ana\ncreated: 2026-09-20T12:00:00Z\n---\n\nOld note for @fred\n')
}

const base = {
  command: 'issues/inbox-digest',
  fixture: 'team',
  github: true,
  prompt: '/pmkit:issues:inbox-digest',
  answers: [],
  notHit: {},
}
const head4 = [
  { step: '1', read: ['capabilities'] },
  { step: '2', read: ['inbox', 'list'], save: 'inbox' },
  { step: '4', read: ['whoami'], save: 'me' },
  { step: '5', read: LIST, save: 'review' },
]
const skipStep3 = { '3 issues list': 'the tracker has user_inbox, so step 3 and its derived list do not run' }
const gh = {
  ...openPr({ number: 9, branch: B.review, requested: ['fred'] }),
  ...openPr({ number: 10, branch: B.cut, author: 'fred', teams: ['fred'], threads: CUT_THREADS }),
  ...openPr({ number: 11, branch: B.nobody, requested: ['fred'] }),
  [`pr view ${B.merged} --json ${VIEW}`]: { stdout: JSON.stringify(merged) },
  'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Not Found (HTTP 404)\n' },
}
// What the review list holds: the issues with a branch and the ones in review, whatever their status and assignee.
const relevant = (issues) => issues.filter((issue) => issue.branch || issue.status.category === 'in_review')

const all = {
  ...base,
  gh,
  setup: (ctx) => setup(ctx),
  steps: [
    ...head4,
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.review], save: 'requested' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.cut], save: 'cut' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.nobody], save: 'nobody' },
    { step: '5.1', read: ['pr', 'blockers', '--branch', B.merged], save: 'mergedPr' },
  ],
  skip: skipStep3,
  expect(repo, saved) {
    assert.deepEqual(repo.newEvents('ISS-6J0B').filter((event) => event.op !== 'assign' && event.op !== 'comment'), [])
    // The fixture holds one issue file with conflict markers (ISS-3Q6T): the digest must call both reads incomplete.
    assert.equal(saved.inbox.complete, false)
    assert.deepEqual(saved.inbox.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.review.problems.map((p) => p.id), ['ISS-3Q6T'])
    assert.deepEqual(saved.inbox.items.map((item) => [item.kind, item.issue, item.by]), [['assignment', 'ISS-6J0B', 'ana'], ['mention', 'ISS-6J0B', 'ana']])
    // N9 and N10: the older mention is hidden, not shown. The digest says so and offers mark-read only with the shown keys.
    assert.equal(saved.inbox.hidden, 1)
    assert.ok(!saved.inbox.items.some((item) => item.issue === 'ISS-5N1R'))
    assert.equal(saved.me.id, 'fred')
    // Reviews are read whatever the status: two of the pull requests belong to in_progress issues. The one with no branch has no pr blockers call.
    assert.deepEqual(relevant(saved.review.issues).map((issue) => [issue.id, issue.status.name, issue.assignee ?? null, issue.branch ?? null]).sort(), [
      ['ISS-1V9Z', 'in_review', null, null], ['ISS-2X6D', 'in_review', 'ana', B.merged], ['ISS-3F7H', 'in_progress', null, B.nobody],
      ['ISS-4M2S', 'in_progress', 'ana', B.cut], ['ISS-8C4W', 'in_review', 'ana', B.review],
    ])
    assert.deepEqual(saved.requested.reviews.requested, ['fred'])
    // A team called like the user is a team request: it is never in `requested`.
    assert.deepEqual(saved.cut.reviews.requested, [])
    assert.deepEqual(saved.cut.reviews.requestedTeams, ['fred'])
    // B1: the thread read is cut and shows no open thread, so the digest says not verified. fred wrote the PR of an issue that is not fred's.
    assert.equal(saved.cut.threads.incomplete, true)
    assert.deepEqual(saved.cut.threads.open, [])
    assert.equal(saved.cut.pr.author.login, 'fred')
    // B2 and B4: an unassigned open PR with an unread protection has blocked null and still asks fred for a review.
    assert.equal(saved.nobody.blocked, null)
    assert.ok(saved.nobody.pr)
    assert.deepEqual(saved.nobody.reviews.requested, ['fred'])
    assert.deepEqual(saved.nobody.reviews.requestedTeams, [])
    assert.deepEqual(saved.nobody.unchecked.map((u) => u.area), ['policies'])
    // B3: a merged PR has no reviews or threads and nothing unchecked.
    assert.equal(saved.mergedPr.pr.state, 'MERGED')
    assert.equal(saved.mergedPr.reviews, null)
    assert.equal(saved.mergedPr.threads, null)
    assert.deepEqual(saved.mergedPr.unchecked, [])
  },
}

// The conflicted file is gone: the inbox is complete, so the digest offers `inbox mark-read --key <key> ...` with exactly the shown keys.
// ISS-4M2S (todo) has a branch and no pull request yet: the read works and finds none, which is a fact, not an incomplete read.
// The issues in review with no branch are "not verified: no branch recorded".
const complete = {
  ...base,
  gh: { [`pr view ${B.cut} --json ${VIEW}`]: { status: 1, stderr: 'no pull requests found for branch "iss-4m2s-csv-column-order"\n' } },
  setup: async (ctx) => {
    await ctx.pmkit(['issues', 'update', 'ISS-4M2S', '--branch', B.cut])
    await ctx.pmkit(['issues', 'move', 'ISS-2X6D', 'in_review'])
    await ctx.pmkit(['issues', 'assign', 'ISS-6J0B', 'fred', '--as', 'ana'])
    const body = path.join(ctx.root, 'mention.md')
    fs.writeFileSync(body, 'Can you look at this, @fred?\n')
    await ctx.pmkit(['issues', 'comment', 'ISS-6J0B', '--body-file', body, '--as', 'ana'])
    fs.rmSync(body)
    fs.rmSync(path.join(ctx.root, '.issues', 'issues', 'ISS-3Q6T'), { recursive: true })
  },
  steps: [...head4, { step: '5.1', read: ['pr', 'blockers', '--branch', B.cut], save: 'noPr' }],
  skip: skipStep3,
  expect(repo, saved) {
    assert.equal(saved.inbox.complete, true)
    assert.deepEqual(saved.inbox.problems, [])
    assert.equal(saved.inbox.hidden, 0)
    assert.deepEqual(saved.review.problems ?? [], [])
    // Step 7 offers mark-read for exactly these keys, so there are some and they are distinct.
    const keys = saved.inbox.items.map((item) => item.key)
    assert.equal(keys.length, 2)
    assert.ok(keys.every((key) => typeof key === 'string' && key !== ''))
    assert.equal(new Set(keys).size, keys.length)
    assert.deepEqual(saved.inbox.items.map((item) => item.kind), ['assignment', 'mention'])
    // A branch with no pull request reads fine and leaves the inbox complete. The command file must not call it "not verified".
    assert.equal(saved.noPr.pr, null)
    assert.ok(!/not verified: no pull request/.test(fs.readFileSync(new URL('../../commands/issues/inbox-digest.md', import.meta.url), 'utf8')))
    // The digest reads only: the offer is text, so nothing is marked seen.
    assert.ok(saved.inbox.items.every((item) => item.seen === false))
  },
}

// The first pull request read is refused with RATE_LIMITED: the digest stops there, says reviews are not verified for every issue
// it did not read, and never says there is nothing to review. The other branches get no call.
const rateLimited = {
  ...base,
  gh: { [`pr view ${B.review} --json ${VIEW}`]: { status: 1, stderr: 'gh: API rate limit exceeded for user (HTTP 403)\n' } },
  setup: (ctx) => setup(ctx),
  steps: [...head4, { step: '5.1', read: ['pr', 'blockers', '--branch', B.review], expectError: 'RATE_LIMITED', save: 'limited' }],
  skip: skipStep3,
  expect(repo, saved) {
    assert.equal(saved.limited.error.code, 'RATE_LIMITED')
    // The branches that were not read are still on the issues, so the digest can list them as not verified.
    assert.ok(relevant(saved.review.issues).filter((issue) => issue.branch).length > 1)
  },
}

export default [all, complete, rateLimited]
