// /pmkit:issues:assign ISS-3F7H ana on the team fixture.
// ISS-3F7H has no assignee, and "ana" matches one member exactly, so step 2 asks nothing.
import assert from 'node:assert/strict'

export default {
  command: 'issues/assign',
  fixture: 'team',
  prompt: '/pmkit:issues:assign ISS-3F7H ana',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['discover'] },
    { step: '3', dryRun: ['issues', 'assign', 'ISS-3F7H', 'ana'] },
    { confirm: 'Step 4' },
    { step: '3', write: ['issues', 'assign', 'ISS-3F7H', 'ana'] },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    assert.equal(repo.issue('ISS-3F7H').assignee, 'ana')
    assert.equal(repo.newEvents('ISS-3F7H').length, 1)
  },
}
