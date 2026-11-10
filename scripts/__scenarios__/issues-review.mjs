// /pmkit:issues:review ISS-5N1R on the team fixture, with GitHub. ISS-5N1R belongs to fred, is in progress and gets
// two acceptance criteria and the branch below in setup. gh answers that the branch has the open pull request #7. Two entries:
//  .0 a small diff and a passing check: the review reads the diff and the checks, then posts the result on the issue and,
//     after a second confirmation, as a review on the pull request with one inline comment.
//  .1 a diff over 2000 lines and a failing check: the cut file is read alone (and whole), the log of the failed run names
//     the step, the check shows as a gap in the comment on the issue, and the user declines the pull request review after its preview.
import assert from 'node:assert/strict'
import path from 'node:path'
import { createGithubHost } from '../lib/github/host.mjs'

const BRANCH = 'iss-5n1r-paginate-the-events-api'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
// pr status reads the pull request with its reviews and merge state, then the blocker reads (threads, protection, rules).
const DETAIL = ',reviews,reviewRequests,mergeable,mergeStateStatus,reviewDecision,baseRefName'
const NO_THREADS = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] } } } } })

/** The argument string of the first graphql call of the threads, taken from the real host so the canned key cannot drift. */
function threadsKey(number) {
  let key
  createGithubHost({ root: '.', env: {}, exec: (cmd, args) => { key = args.join(' '); return { status: 0, stdout: NO_THREADS, stderr: '' } } }).prThreads(number)
  return key
}
const pr = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN',
  isDraft: false, headRefName: BRANCH, author: { login: 'fred' }, mergedAt: null,
}
const DIFF = 'diff --git a/src/events.mjs b/src/events.mjs\n--- a/src/events.mjs\n+++ b/src/events.mjs\n@@ -1 +1,2 @@\n-export const page = (n) => n\n+export const page = (n, cursor) => n\n+export const CURSOR = true\n'
// A generated file of 2100 lines: its section has 5 header lines, so it passes the default cut of 2000 lines on its own.
const BIG = `diff --git a/src/big.mjs b/src/big.mjs\nnew file mode 100644\n--- /dev/null\n+++ b/src/big.mjs\n@@ -0,0 +1,2100 @@\n${Array.from({ length: 2100 }, (_, i) => `+export const T${i} = ${i}\n`).join('')}`
const BIG_LINES = 2105
const REVIEW_API = 'api repos/{owner}/{repo}/pulls/7/reviews --method POST --input -'
const inputs = path.join(import.meta.dirname, '_inputs')
const comment = (file) => ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, file), '--redact']
const review = ['pr', 'review', '--issue', 'ISS-5N1R', '--body-file', path.join(inputs, 'pr-review.md'), '--comments-file', path.join(inputs, 'pr-review-comments.json'), '--redact']

const ghFor = (diff, checks) => ({
  [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
  'pr diff 7 --color never': { stdout: diff },
  'pr view 7 --json baseRefName,headRefOid': { stdout: JSON.stringify({ baseRefName: 'main', headRefOid: 'sha7' }) },
  [`pr view ${BRANCH} --json ${VIEW}${DETAIL}`]: { stdout: JSON.stringify({ ...pr, reviews: [], reviewRequests: [], mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main' }) },
  'pr checks 7 --json name,state,bucket,link': { stdout: JSON.stringify(checks) },
  [threadsKey(7)]: { stdout: NO_THREADS },
  'api repos/{owner}/{repo}/branches/main/protection': { status: 1, stderr: 'gh: Branch not protected (HTTP 404)\n' },
  'api repos/{owner}/{repo}/rules/branches/main?per_page=100&page=1': { stdout: '[]' },
})
const setup = async ({ pmkit }) => {
  await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md'), '--branch', BRANCH])
}
const NOT_FROM_BRANCH = 'the ID is given, so step 1 does not look for the issue from the branch'
const HOST = 'the git host is GitHub, so the diff comes from pr diff and the default branch is not read'
const onlyComment = (repo) => {
  const comments = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment')
  assert.equal(comments.length, 1)
  assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.field === 'status' || event.op === 'check').length, 0, 'the review changes nothing else')
  return repo.file(`.issues/issues/ISS-5N1R/comments/${comments[0].to}`)
}

const happy = {
  command: 'issues/review',
  fixture: 'team',
  github: true,
  gh: {
    ...ghFor(DIFF, [{ name: 'test', state: 'SUCCESS', bucket: 'pass', link: 'https://github.com/o/r/actions/runs/41/job/1' }]),
    [REVIEW_API]: { stdout: JSON.stringify({ id: 99, html_url: 'https://github.com/o/r/pull/7#pullrequestreview-99' }) },
  },
  setup,
  prompt: '/pmkit:issues:review ISS-5N1R',
  answers: ['Yes', 'Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'diff', '--branch', BRANCH] },
    { step: '4', read: ['pr', 'status', '--branch', BRANCH] },
    { step: '7.1', dryRun: comment('review.md') },
    { confirm: 'Step 7.1' },
    { step: '7.1', write: comment('review.md') },
    { step: '7.2', dryRun: review },
    { confirm: 'Step 7.2' },
    { step: '7.2', write: review },
  ],
  skip: {
    '1 issues list': NOT_FROM_BRANCH,
    '3 default-branch': HOST,
    '3.2 pr diff': 'the diff is short, so it is not cut and no file is read alone',
    '4 ci logs': 'the only check passes, so no failed run is read',
  },
  notHit: {},
  expect(repo) {
    assert.ok(onlyComment(repo).includes('1. gap'))
    assert.equal(repo.ghCalls().filter((call) => call === REVIEW_API).length, 1, 'one review is posted on the pull request')
  },
}

const cut = {
  command: 'issues/review',
  fixture: 'team',
  github: true,
  gh: {
    ...ghFor(DIFF + BIG, [{ name: 'test', state: 'FAILURE', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/42/job/1' }]),
    'run view 42 --json workflowName,url,conclusion,status,createdAt,headSha': { stdout: JSON.stringify({ workflowName: 'test', url: 'https://github.com/o/r/actions/runs/42', conclusion: 'failure', status: 'completed', createdAt: '2026-10-23T09:00:00Z', headSha: 'sha42' }) },
    'run view 42 --log-failed': { stdout: 'test\tRun tests\texpected 3 events, got 5\n' },
  },
  setup,
  prompt: '/pmkit:issues:review ISS-5N1R',
  answers: ['Yes', 'No'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'diff', '--branch', BRANCH] },
    { step: '3.2', read: ['pr', 'diff', '--branch', BRANCH, '--file', 'src/big.mjs'] },
    { step: '3.2', read: ['pr', 'diff', '--branch', BRANCH, '--file', 'src/big.mjs', '--max-lines', String(BIG_LINES)] },
    { step: '4', read: ['pr', 'status', '--branch', BRANCH] },
    { step: '4', read: ['ci', 'logs', '--run', '42'] },
    { step: '7.1', dryRun: comment('review-checks.md') },
    { confirm: 'Step 7.1' },
    { step: '7.1', write: comment('review-checks.md') },
    { step: '7.2', dryRun: review },
    { confirm: 'Step 7.2' },
  ],
  skip: {
    '1 issues list': NOT_FROM_BRANCH,
    '3 default-branch': HOST,
  },
  notHit: {},
  expect(repo) {
    const text = onlyComment(repo)
    assert.ok(text.includes('gap: the check test fails'), 'the failing check is a gap')
    assert.ok(text.includes('https://github.com/o/r/actions/runs/42') && !text.includes('expected 3 events'), 'the comment has the run link, never a log line')
    assert.ok(!repo.ghCalls().includes(REVIEW_API), 'nothing is posted on the pull request')
  },
}

export default [happy, cut]
