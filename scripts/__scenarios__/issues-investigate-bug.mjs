// /pmkit:issues:investigate-bug ISS-5N1R on the team fixture, with GitHub. ISS-5N1R belongs to fred, is in progress and gets
// two acceptance criteria and the branch below in setup. The branch has the open pull request #7 and a failed run 42, so the
// command reads the issue, the log and the diff, and posts the diagnosis after one confirmation.
import assert from 'node:assert/strict'
import path from 'node:path'

const BRANCH = 'iss-5n1r-paginate-the-events-api'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const RUN_LIST = `run list --branch ${BRANCH} --limit 50 --json databaseId,workflowName,status,conclusion,url,createdAt,headSha`
const pr = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN',
  isDraft: false, headRefName: BRANCH, author: { login: 'fred' }, mergedAt: null,
}
const DIFF = 'diff --git a/src/events.mjs b/src/events.mjs\n--- a/src/events.mjs\n+++ b/src/events.mjs\n@@ -1 +1,2 @@\n-export const page = (n) => n\n+export const page = (n, cursor) => n\n+export const CURSOR = true\n'
const inputs = path.join(import.meta.dirname, '_inputs')
const SECRET = `ghp_${'a'.repeat(36)}`
const LOG = `test\tRun tests\texpected 3 events, got 5\ntest\tRun tests\tGITHUB_TOKEN=${SECRET}\ntest\tRun tests\tclone https://ci:hunter2@github.com/o/r.git\n`
// The draft the agent writes in step 10.1. For CI it holds the run link and the step name, never a log line. It also quotes
// the reporter, whose text holds secrets, so only the CLI keeps them out.
const RUN_URL = 'https://github.com/o/r/actions/runs/42'
const DRAFT = `Diagnosis of ISS-5N1R.\n\n1. The cursor is ignored (medium). src/events.mjs:1 takes cursor and never uses it. CI: ${RUN_URL}, step "Run tests" of the job test.\n\nThe reporter wrote: "GITHUB_TOKEN=${SECRET} then a clone of https://ci:hunter2@github.com/o/r.git fails".\n`
// The body is the redacted text the CLI returned, plus the count line. Nothing here is written by hand.
const body = (saved) => `${saved.redacted.text}\n${saved.redacted.summary}\n`
const comment = ['issues', 'comment', 'ISS-5N1R', '--body-file', '-']

export default {
  command: 'issues/investigate-bug',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr diff 7 --color never': { stdout: DIFF },
    [RUN_LIST]: { stdout: JSON.stringify([{ databaseId: 42, workflowName: 'test', status: 'completed', conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/42', createdAt: '2026-10-23T09:00:00Z', headSha: 'sha42' }]) },
    'run view 42 --log-failed': { stdout: LOG },
    'pr checks 7 --json name,state,bucket': { stdout: JSON.stringify([{ name: 'test', state: 'FAILURE', bucket: 'fail' }]) },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [] }) },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md'), '--branch', BRANCH])
  },
  prompt: '/pmkit:issues:investigate-bug ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'status', '--branch', BRANCH] },
    { step: '4', read: ['ci', 'logs', '--branch', BRANCH] },
    { step: '6', read: ['pr', 'diff', '--branch', BRANCH] },
    { step: '10.2', read: ['text', 'redact', '--file', '-'], stdin: DRAFT, save: 'redacted' },
    { step: '10.3', dryRun: comment, stdin: body },
    { confirm: 'Step 10' },
    { step: '10.3', write: comment, stdin: body },
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '5 deploys list': 'the issue names no environment, so step 5 does not run',
  },
  notHit: {},
  expect(repo) {
    const events = repo.newEvents('ISS-5N1R')
    const comments = events.filter((event) => event.op === 'comment')
    assert.equal(comments.length, 1)
    const text = repo.file(`.issues/issues/ISS-5N1R/comments/${comments[0].to}`)
    assert.ok(text.includes('[redacted]'), 'the comment holds the redaction mark')
    assert.ok(text.includes(RUN_URL) && text.includes('Run tests'), 'the comment has the run link and the step name')
    for (const line of LOG.split('\n').filter(Boolean)) assert.ok(!text.includes(line.split('\t').at(-1)), `the comment holds no line of the log: ${line}`)
    assert.ok(!text.includes(SECRET) && !text.includes('hunter2'), 'the comment holds no secret value')
    assert.ok(text.includes('Redacted 2 values.'), 'the comment says how many values were replaced')
    assert.equal(events.filter((event) => event.field === 'status' || event.op === 'check').length, 0, 'the investigation changes nothing else')
  },
}
