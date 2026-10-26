// /pmkit:issues:move ISS-2X6D done on the team fixture.
// ISS-2X6D has a child, ISS-4M2S (todo), and a blocker, ISS-5N1R (in progress),
// so step 2 reads both and the warning lists them. The user approves the move anyway.
import assert from 'node:assert/strict'

export default {
  command: 'issues/move',
  fixture: 'team',
  prompt: '/pmkit:issues:move ISS-2X6D done',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-2X6D'] },
    { step: '2', read: ['issues', 'get', 'ISS-4M2S'] },
    { step: '2', read: ['issues', 'get', 'ISS-5N1R'] },
    { step: '4', dryRun: ['issues', 'move', 'ISS-2X6D', 'done'] },
    { confirm: 'Step 5' },
    { step: '4', write: ['issues', 'move', 'ISS-2X6D', 'done'] },
  ],
  skip: { '3 discover': 'done has one status in the team fixture, so step 3 does not ask' },
  notHit: {},
  expect(repo) {
    assert.equal(repo.issue('ISS-2X6D').status, 'done')
    assert.equal(repo.newEvents('ISS-2X6D').filter((event) => event.op === 'move').length, 1)
  },
}
