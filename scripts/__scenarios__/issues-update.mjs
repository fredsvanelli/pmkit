// /pmkit:issues:update ISS-3F7H with a new priority, estimate and acceptance criteria.
// None of these is a sprint change, so the question is the ordinary one of step 6.
import assert from 'node:assert/strict'
import path from 'node:path'

const criteria = path.join(import.meta.dirname, '_inputs', 'criteria.md')
const args = ['issues', 'update', 'ISS-3F7H', '--priority', 'high', '--estimate', '3', '--criteria-file', criteria]

export default {
  command: 'issues/update',
  fixture: 'team',
  prompt: '/pmkit:issues:update ISS-3F7H priority high, estimate 3, and two acceptance criteria',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-3F7H'] },
    { step: '2', read: ['discover'] },
    { step: '5', dryRun: args },
    { confirm: 'Step 6' },
    { step: '5', write: args },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const issue = repo.issue('ISS-3F7H')
    assert.equal(issue.priority, 'high')
    assert.equal(issue.estimate, 3)
    assert.equal((repo.file('.issues/issues/ISS-3F7H/issue.md').match(/^- \[ \] /gm) ?? []).length, 2)
  },
}
