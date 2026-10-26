// /pmkit:issues:work ISS-4M2S on the team fixture, with GitHub. ISS-4M2S is assigned to fred, in todo, with the
// parent ISS-2X6D (an issue, not an epic) and no acceptance criteria, which is the one readiness problem of step 3.
// The working tree is clean and fred is on main, so steps 4 and 6 do not ask about uncommitted changes or the base.
// Setup keeps the code change of step 8 on a side branch, `implementation`, because a scenario entry cannot write
// source files: step 8 checks that file out and commits it, standing in for the agent's work.
// gh answers that the issue branch already has an open draft PR #7, so pr open takes the `existing: true` path and
// only pushes, then pr ready marks the draft ready for review.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const BRANCH = 'iss-4m2s-fix-csv-column-order'
const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const draft = {
  number: 7, url: 'https://github.com/o/r/pull/7', title: 'Fix CSV column order (ISS-4M2S)', state: 'OPEN',
  isDraft: true, headRefName: BRANCH, author: { login: 'fred' }, mergedAt: null,
}
const input = (file) => path.join(import.meta.dirname, '_inputs', file)
const move = (status) => ['issues', 'move', 'ISS-4M2S', status]
const branch = ['issues', 'branch', 'ISS-4M2S']
const postPlan = ['issues', 'comment', 'ISS-4M2S', '--body-file', input('plan.md')]
const open = ['pr', 'open', '--issue', 'ISS-4M2S', '--body-file', input('pr-body.md')]
const ready = ['pr', 'ready', '--issue', 'ISS-4M2S']
const postSummary = ['issues', 'comment', 'ISS-4M2S', '--body-file', input('summary.md')]
const followUp = ['issues', 'create', '--title', 'Check the CSV header against the finance template']
const relate = (saved) => ['issues', 'link', saved.followUp.after.id, 'ISS-4M2S', '--kind', 'related']

export default {
  command: 'issues/work',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view ${BRANCH} --json ${VIEW}`]: { stdout: JSON.stringify(draft) },
    'pr ready 7': { stdout: '' },
    [`pr view 7 --json ${VIEW}`]: { stdout: JSON.stringify({ ...draft, isDraft: false }) },
  },
  async setup({ root, git }) {
    git('switch', '-q', '-c', 'implementation')
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'src', 'csv-columns.mjs'), "export const CSV_COLUMNS = ['date', 'invoice', 'customer', 'total']\n")
    git('add', 'src/csv-columns.mjs')
    git('commit', '-qm', 'the code change that step 8 commits')
    git('switch', '-q', 'main')
  },
  prompt: '/pmkit:issues:work ISS-4M2S',
  answers: ['Yes', 'Yes', 'Yes', 'Go ahead and post it', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Check the CSV header against the finance template', 'Yes', 'Yes'],
  steps: [
    // Step 2: the issue with its comments, and its parent, which is an issue.
    { step: '2', read: ['issues', 'get', 'ISS-4M2S', '--comments'], save: 'issue' },
    { step: '2', read: ['issues', 'get', 'ISS-2X6D'] },
    // Step 3: ISS-4M2S has no acceptance criteria, and the user continues.
    { confirm: 'Step 3' },
    // Step 4: the working tree is clean.
    { step: '4', git: ['status', '--porcelain'] },
    // Step 5: already assigned to fred, so only the move to in_progress.
    { step: '5.2', dryRun: move('in_progress') },
    { confirm: 'Step 5' },
    { step: '5.2', write: move('in_progress') },
    // Step 6: on main with no extra commits, so the branch starts from main.
    { step: '6', git: ['branch', '--show-current'] },
    { step: '6', git: ['log', 'main..HEAD', '--oneline'] },
    { step: '6', dryRun: branch },
    { confirm: 'Step 6' },
    { step: '6', write: branch },
    // Step 7: the plan is approved, then posted as a comment.
    { confirm: 'Step 7' },
    { step: '7', dryRun: postPlan },
    { confirm: 'Step 7' },
    { step: '7', write: postPlan },
    // Step 8: the implementation, committed with the issue ID.
    { step: '8', git: ['checkout', 'implementation', '--', 'src/csv-columns.mjs'] },
    { step: '8', git: ['commit', '-qm', 'fix: write the CSV columns in the finance order (ISS-4M2S)'] },
    // Step 9: push to the open draft PR, mark it ready, post the summary, move to in_review. Each write asks once.
    { step: '9.2', dryRun: open, save: 'openPreview' },
    { confirm: 'Step 9' },
    { step: '9.2', write: open, save: 'opened' },
    { step: '9.4', dryRun: ready },
    { confirm: 'Step 9' },
    { step: '9.4', write: ready, save: 'ready' },
    { step: '9.5', dryRun: postSummary },
    { confirm: 'Step 9' },
    { step: '9.5', write: postSummary },
    { step: '9.6', dryRun: move('in_review') },
    { confirm: 'Step 9' },
    { step: '9.6', write: move('in_review') },
    // Step 10: one follow-up, created and linked as related.
    { step: '10', dryRun: followUp },
    { confirm: 'Step 10' },
    { step: '10', write: followUp, save: 'followUp' },
    { step: '10', dryRun: relate },
    { confirm: 'Step 10' },
    { step: '10', write: relate },
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not pick the issue from the list',
    '2 epic get': 'the parent ISS-2X6D is an issue, so step 2 runs issues get for it',
    '5.1 issues assign': 'ISS-4M2S is already assigned to fred',
  },
  notHit: {
    'Step 1': 'the ID is given, so no issue is chosen from the list',
    'Step 4': 'the working tree is clean',
  },
  expect(repo, saved) {
    const issue = repo.issue('ISS-4M2S')
    assert.equal(issue.status, 'in_review')
    assert.equal(issue.branch, BRANCH)
    assert.match(repo.git('ls-remote', '--heads', 'origin', BRANCH), new RegExp(`refs/heads/${BRANCH}`))
    assert.match(repo.git('log', '-1', '--format=%s', `origin/${BRANCH}`).trim(), /\(ISS-4M2S\)$/, 'pr open pushed the step 8 commit to origin')
    assert.ok(repo.ghCalls().includes('pr ready 7'), repo.ghCalls().join('\n'))
    assert.equal(repo.newEvents('ISS-4M2S').filter((event) => event.op === 'comment').length, 2, 'the plan and the summary')
    assert.deepEqual(saved.issue.acceptanceCriteria, [], 'the readiness problem that step 3 asks about')
    assert.equal(saved.openPreview.existing, true)
    assert.equal(saved.opened.isDraft, true, 'pr open returns the draft, so sub-step 4 runs pr ready')
    assert.equal(saved.ready.isDraft, false)
    assert.deepEqual(repo.issue(saved.followUp.after.id).related, ['ISS-4M2S'])
  },
}
