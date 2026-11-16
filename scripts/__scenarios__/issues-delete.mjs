// /pmkit:issues:delete ISS-7T4C on the no-sprints fixture.
// No other issue references ISS-7T4C, so the dry run succeeds, the preview is shown and the user confirms.
import assert from 'node:assert/strict'

export default {
  command: 'issues/delete',
  fixture: 'no-sprints',
  prompt: '/pmkit:issues:delete ISS-7T4C',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-7T4C'] },
    { step: '2', dryRun: ['issues', 'delete', 'ISS-7T4C'] },
    { confirm: 'Step 6' },
    { step: '7', write: ['issues', 'delete', 'ISS-7T4C'] },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    assert.equal(repo.file(".issues/issues/ISS-7T4C/issue.md"), null)
  },
}
