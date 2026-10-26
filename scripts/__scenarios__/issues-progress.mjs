// /pmkit:issues:progress ISS-5N1R: post a comment, tick criterion 1 and log 30 minutes.
// ISS-5N1R belongs to fred and is in progress, but the fixture gives it no criteria, so setup adds two.
import assert from 'node:assert/strict'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const comment = ['issues', 'comment', 'ISS-5N1R', '--body-file', path.join(inputs, 'comment.md')]
const tick = ['issues', 'update', 'ISS-5N1R', '--check', '1']
const log = ['issues', 'log-time', 'ISS-5N1R', '30']

export default {
  command: 'issues/progress',
  fixture: 'team',
  prompt: '/pmkit:issues:progress ISS-5N1R',
  answers: ['Yes', 'Criterion 1', '30'],
  async setup({ pmkit }) {
    await pmkit(['issues', 'update', 'ISS-5N1R', '--criteria-file', path.join(inputs, 'criteria.md')])
  },
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { confirm: 'Step 4' },
    { step: '5', dryRun: comment },
    { step: '5', write: comment },
    { step: '7', dryRun: tick },
    { confirm: 'Step 7' },
    { step: '7', write: tick },
    { step: '8', dryRun: log },
    { confirm: 'Step 8' },
    { step: '8', write: log },
  ],
  skip: { '1 issues list': 'the ID is given, so step 1 does not look for the issue from the branch' },
  notHit: {},
  expect(repo) {
    const issue = repo.file('.issues/issues/ISS-5N1R/issue.md')
    assert.match(issue, /^- \[x\] A 5xx answer schedules a retry$/m)
    assert.match(issue, /^- \[ \] /m, 'criterion 2 stays unchecked')
    const comments = repo.newEvents('ISS-5N1R').filter((event) => event.op === 'comment')
    assert.equal(comments.length, 1)
    assert.ok(repo.file(`.issues/issues/ISS-5N1R/comments/${comments[0].to}`).includes('Added the cursor to the events endpoint.'))
    assert.equal(repo.newEvents('ISS-5N1R').filter((event) => event.op === 'log_time').length, 1)
  },
}
