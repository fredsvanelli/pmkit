// /pmkit:issues:pause ISS-5N1R: post the handoff note, move the issue to todo, keep the assignee and open a draft PR.
// The branch feat-retries has one commit and is recorded on the issue. The branch has no PR: the first two views
// (the dry run and the real run) find none, and the view after pr create returns the new draft PR #9.
import assert from 'node:assert/strict'
import path from 'node:path'

const VIEW = 'number,url,title,state,isDraft,headRefName,author,mergedAt'
const noPr = { status: 1, stderr: 'no pull requests found for branch "feat-retries"\n' }
const created = { number: 9, url: 'https://github.com/o/r/pull/9', title: 'Paginate the events API (ISS-5N1R)', state: 'OPEN', isDraft: true, headRefName: 'feat-retries', author: { login: 'fred' }, mergedAt: null }
const note = path.join(import.meta.dirname, '_inputs', 'comment.md')
const comment = ['issues', 'comment', 'ISS-5N1R', '--body-file', note]
const move = ['issues', 'move', 'ISS-5N1R', 'todo']
const open = ['pr', 'open', '--issue', 'ISS-5N1R', '--draft']

export default {
  command: 'issues/pause',
  fixture: 'team',
  github: true,
  gh: {
    [`pr view feat-retries --json ${VIEW}`]: [noPr, noPr, { stdout: JSON.stringify(created) }],
    'pr create --title Paginate the events API (ISS-5N1R) --body-file - --head feat-retries --base main --draft': { stdout: 'https://github.com/o/r/pull/9\n' },
  },
  async setup({ pmkit, git }) {
    git('switch', '-c', 'feat-retries')
    git('commit', '--allow-empty', '-qm', 'feat: add the cursor (ISS-5N1R)')
    await pmkit(['issues', 'update', 'ISS-5N1R', '--branch', 'feat-retries'])
  },
  prompt: '/pmkit:issues:pause ISS-5N1R',
  answers: ['Yes', 'Move to todo, keep the assignee', 'Yes', 'Yes', 'Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-5N1R'] },
    { confirm: 'Step 2' },
    { step: '4', dryRun: comment },
    { step: '4', dryRun: move },
    { confirm: 'Step 5' },
    { step: '4', write: comment },
    { step: '4', write: move },
    { step: '7', dryRun: open, save: 'preview' },
    { confirm: 'Step 7' },
    { step: '7', write: open, save: 'opened' },
  ],
  skip: {
    '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch',
    '4 issues assign': 'the user keeps the assignee, so there is nothing to preview',
    'missing issues update': 'the issue has a branch, so pr open does not fail with INVALID_INPUT',
  },
  notHit: { 'Recording the current branch on the issue, when `pr open` finds no branch': 'the issue already has a branch' },
  expect(repo, saved) {
    assert.equal(repo.issue('ISS-5N1R').status, 'todo')
    assert.equal(repo.issue('ISS-5N1R').assignee, 'fred')
    assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment').length, 1)
    assert.match(repo.git('--git-dir', path.join(repo.git('rev-parse', '--show-toplevel'), '..', 'origin.git'), 'branch', '--list', 'feat-retries'), /feat-retries/)
    assert.ok(repo.ghCalls().some((call) => call.startsWith('pr create') && call.endsWith('--draft')), repo.ghCalls().join('\n'))
    assert.equal(saved.preview.existing, false)
    assert.equal(saved.preview.draft, true)
    assert.equal(saved.opened.number, 9, 'the view after pr create returns the new PR')
    assert.equal(saved.opened.existing, false)
  },
}
