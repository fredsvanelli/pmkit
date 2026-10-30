// /pmkit:issues:review ISS-5N1R on the team fixture, with GitHub. ISS-5N1R belongs to fred, is in progress and gets
// two acceptance criteria and the branch below in setup. gh answers that the branch has the open pull request #7
// with a small diff, so the review reads the pull request diff and posts the result after one confirmation.
import assert from 'node:assert/strict'
import path from 'node:path'

const BRANCH = 'iss-5n1r-paginate-the-events-api'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const pr = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN',
  isDraft: false, headRefName: BRANCH, author: { login: 'fred' }, mergedAt: null,
}
const DIFF = 'diff --git a/src/events.mjs b/src/events.mjs\n--- a/src/events.mjs\n+++ b/src/events.mjs\n@@ -1 +1,2 @@\n-export const page = (n) => n\n+export const page = (n, cursor) => n\n+export const CURSOR = true\n'
const inputs = path.join(import.meta.dirname, '_inputs')
const comment = ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'review.md')]

export default {
  command: 'issues/review',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr diff 7 --color never': { stdout: DIFF },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md'), '--branch', BRANCH])
  },
  prompt: '/pmkit:issues:review ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'diff', '--branch', BRANCH] },
    { confirm: 'Step 6' },
    { step: '6', dryRun: comment },
    { step: '6', write: comment },
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '3.2 pr diff': 'the diff is short, so it is not cut and the second read does not run',
  },
  notHit: {},
  expect(repo) {
    const comments = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment')
    assert.equal(comments.length, 1)
    assert.ok(repo.file(`.issues/issues/ISS-5N1R/comments/${comments[0].to}`).includes('2. gap'))
    assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.field === 'status' || event.op === 'check').length, 0, 'the review changes nothing else')
  },
}
