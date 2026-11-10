// /pmkit:issues:investigate-bug ISS-5N1R on the team fixture. Three entries:
//  .0 with GitHub. ISS-5N1R belongs to fred, is in progress and gets two acceptance criteria and the branch below in setup. The
//     branch has the open pull request #7 and a failed run 42, so the command reads the issue, the log, the diff and the code of
//     the branch, and posts the diagnosis (redacted by the CLI with --redact) after one confirmation.
//  .1 degraded: the issue has no branch. The pull request, CI and the diff are not read; the deployments are (step 5 needs no branch).
//  .2 degraded: git_host is none. pr status answers NOT_SUPPORTED, so steps 4 and 5 are skipped and the diff is the local one (step 6).
//  .3 degraded: the branch of the issue is not a valid name (`x$(id)`). Step 2 treats it as no branch: no command takes the name.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validBranch } from '../lib/config.mjs'

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
const comment = ['issues', 'comment', 'ISS-5N1R', '--body-file', '-', '--redact']

const happy = {
  command: 'issues/investigate-bug',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(pr) },
    'pr diff 7 --color never': { stdout: DIFF },
    [RUN_LIST]: { stdout: JSON.stringify([{ databaseId: 42, workflowName: 'test', status: 'completed', conclusion: 'failure', url: 'https://github.com/o/r/actions/runs/42', createdAt: '2026-10-23T09:00:00Z', headSha: 'sha42' }]) },
    'run view 42 --log-failed': { stdout: LOG },
    'pr checks 7 --json name,state,bucket,link': { stdout: JSON.stringify([{ name: 'test', state: 'FAILURE', bucket: 'fail' }]) },
    'pr view 7 --json reviews,reviewRequests': { stdout: JSON.stringify({ reviews: [], reviewRequests: [] }) },
  },
  async setup({ root, pmkit, git }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md'), '--branch', BRANCH])
    // The branch of the issue holds the code the command reads. The working tree stays on main, where the file does not exist.
    git('switch', '-q', '-c', BRANCH)
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src', 'events.mjs'), 'export const page = (n, cursor) => n\n')
    git('add', 'src')
    git('commit', '-q', '-m', 'paginate')
    git('switch', '-q', 'main')
    // The search text, written by the file tool outside .issues/ (git does not track it here, and the scenario ignores nothing else).
    fs.writeFileSync(path.join(root, 'pattern.txt'), 'cursor\n')
  },
  prompt: '/pmkit:issues:investigate-bug ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'status', '--branch', BRANCH] },
    { step: '4', read: ['ci', 'logs', '--branch', BRANCH] },
    { step: '6', read: ['pr', 'diff', '--branch', BRANCH] },
    { step: '7', git: ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`] },
    { step: '7', git: ['show', `refs/heads/${BRANCH}:src/events.mjs`] },
    // The pattern is in a file (-f), so a pattern such as -Ocmd is text, never an option, and -F reads it as plain text.
    { step: '7', git: ['grep', '-F', '-f', 'pattern.txt', `refs/heads/${BRANCH}`, '--', 'src/events.mjs'] },
    { step: '10.3', dryRun: comment, stdin: DRAFT },
    { confirm: 'Step 10' },
    { step: '10.3', write: comment, stdin: DRAFT },
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '6 default-branch': 'the git host is GitHub, so the diff comes from pr diff and the default branch is not read',
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
    // The comment is the draft with the reporter's line replaced from the secret key to its end (PMK-197: a value after a
    // secret key runs to the end of the line); the other lines and the code reference stay.
    const redacted = DRAFT.replace(/GITHUB_TOKEN=.*/, 'GITHUB_TOKEN=[redacted]')
    assert.ok(text.includes(`${redacted.trimEnd()}\n\nRedacted 2 values.`), 'the comment is the draft with the reporter line redacted from the key on and nothing else changed')
    assert.equal(events.filter((event) => event.field === 'status' || event.op === 'check').length, 0, 'the investigation changes nothing else')
  },
}

// The draft of a degraded run: it says what was not read, and quotes a secret the reporter pasted.
const degradedDraft = (notRead) => `Diagnosis of ISS-5N1R.\n\n1. The cursor is ignored (low). No source supports more.\n\nNot read: ${notRead}.\nThe reporter wrote: "password=hunter2xyz".\n`
const degradedExpect = (notRead) => (repo) => {
  const comments = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment')
  assert.equal(comments.length, 1)
  const text = repo.file(`.issues/issues/ISS-5N1R/comments/${comments[0].to}`)
  assert.ok(text.includes(`Not read: ${notRead}.`), 'the comment says what was not read')
  assert.ok(!text.includes('hunter2xyz') && text.includes('[redacted]'), 'the comment holds no secret value')
  assert.ok(text.trimEnd().endsWith('Redacted 1 value.'), 'the comment ends with the count line')
}
const postSteps = (draft) => [
  { step: '10.3', dryRun: comment, stdin: draft },
  { confirm: 'Step 10' },
  { step: '10.3', write: comment, stdin: draft },
]

// No branch: the pull request, CI and the diff are not read, and the code is read from the working tree. Step 5 reads the
// deployments of the environment the reporter names, which needs no branch.
const NO_BRANCH = 'the pull request, CI and the diff, because the issue has no branch'
const noBranchDraft = degradedDraft(NO_BRANCH)
const noBranch = {
  command: 'issues/investigate-bug',
  fixture: 'team',
  github: true,
  gh: {
    'api repos/{owner}/{repo}/deployments?per_page=20&environment=production': { stdout: JSON.stringify([]) },
  },
  async setup({ pmkit }) {
    await pmkit(['issues', 'comment', 'ISS-5N1R', '--body-file', '-'], { stdin: 'The events page breaks in production since Tuesday.\n' })
  },
  prompt: '/pmkit:issues:investigate-bug ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '5', read: ['deploys', 'list', '--environment', 'production'] },
    ...postSteps(noBranchDraft),
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '3 pr status': 'the issue has no branch, so there is no pull request to read',
    '4 ci logs': 'the issue has no branch, so there is no CI run to read',
    '6 pr diff': 'the issue has no branch, so there is no diff to read',
    '6 default-branch': 'the issue has no branch, so step 6 is skipped',
  },
  notHit: {},
  expect: degradedExpect(NO_BRANCH),
}

// git_host none (the fixture default), the issue has a branch: pr status and ci logs answer NOT_SUPPORTED, so the command
// says CI and the pull request cannot be read, reads the diff with git, and posts what it found.
const NO_HOST = 'the pull request and CI, because git_host is none'
const noHostDraft = degradedDraft(NO_HOST)
const noHost = {
  command: 'issues/investigate-bug',
  fixture: 'team',
  git: true,
  async setup({ root, pmkit, git }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md'), '--branch', BRANCH])
    git('switch', '-q', '-c', BRANCH)
    fs.writeFileSync(path.join(root, 'events.mjs'), 'export const page = (n, cursor) => n\n')
    git('add', 'events.mjs')
    git('commit', '-q', '-m', 'paginate')
  },
  prompt: '/pmkit:issues:investigate-bug ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'] },
    { step: '3', read: ['pr', 'status', '--branch', BRANCH], expectError: 'NOT_SUPPORTED' },
    { step: '6', read: ['default-branch'] },
    // The refs come first, with the full names of step 7, then the diff between them (investigate-bug.md, "If something is missing").
    { step: '7', git: ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`] },
    { step: '6', git: ['rev-parse', '--verify', '--quiet', 'refs/heads/main'] },
    { step: '6', git: ['diff', `refs/heads/main...refs/heads/${BRANCH}`] },
    ...postSteps(noHostDraft),
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '4 ci logs': 'pr status answered NOT_SUPPORTED, so steps 4 and 5 are skipped',
    '5 deploys list': 'pr status answered NOT_SUPPORTED, so steps 4 and 5 are skipped',
    '6 pr diff': 'the git host is none, so the diff is read with git diff, not pr diff',
  },
  notHit: {},
  expect: degradedExpect(NO_HOST),
}

// The branch of the issue is data from the tracker. A name a shell would run is never put in a command: step 2 treats the issue
// as having no branch, so the CLI reads and the git commands that take the name are not called, and the draft says why.
const BAD = 'x$(id)'
const NOT_VALID = 'the pull request, CI and the code of the branch, because the branch name is not valid'
const invalidDraft = degradedDraft(NOT_VALID)
const invalidBranch = {
  command: 'issues/investigate-bug',
  fixture: 'team',
  git: true,
  async setup({ root }) {
    // The record is edited by hand to hold a name that fails validBranch, as a hand-edited or imported issue would (refusing it in the CLI is a follow-up of PMK-229).
    const file = path.join(root, '.issues', 'issues', 'ISS-5N1R', 'issue.md')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^---\n/, `---\nbranch: '${BAD}'\n`))
  },
  prompt: '/pmkit:issues:investigate-bug ISS-5N1R',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R', '--comments'], save: 'issue' },
    ...postSteps(invalidDraft),
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '3 pr status': 'the branch name is not valid, so step 2 treats the issue as having no branch',
    '4 ci logs': 'the branch name is not valid, so there is no CI run to read',
    '5 deploys list': 'the issue names no environment, so step 5 does not run',
    '6 pr diff': 'the branch name is not valid, so there is no diff to read',
    '6 default-branch': 'the branch name is not valid, so step 6 is skipped',
  },
  notHit: {},
  expect(repo, saved) {
    assert.equal(saved.issue.branch, BAD, 'the tracker holds the name that is not valid')
    assert.equal(validBranch(saved.issue.branch), false, 'validBranch refuses it, which is the rule step 2 states')
    degradedExpect(NOT_VALID)(repo)
  },
}

export default [happy, noBranch, noHost, invalidBranch]
