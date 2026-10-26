// /pmkit:issues:link ISS-6J0B blocks ISS-3F7H. Both issues are in the backlog and neither has links.
import assert from 'node:assert/strict'

export default {
  command: 'issues/link',
  fixture: 'team',
  prompt: '/pmkit:issues:link ISS-6J0B blocks ISS-3F7H',
  answers: ['Yes'],
  steps: [
    { step: '2', read: ['issues', 'get', 'ISS-6J0B'] },
    { step: '2', read: ['issues', 'get', 'ISS-3F7H'] },
    { step: '3', dryRun: ['issues', 'link', 'ISS-6J0B', 'ISS-3F7H', '--kind', 'blocks'] },
    { confirm: 'Step 5' },
    { step: '3', write: ['issues', 'link', 'ISS-6J0B', 'ISS-3F7H', '--kind', 'blocks'] },
  ],
  skip: { '4 issues parent': 'this scenario links two issues, so the parent path of step 4 does not run' },
  notHit: {},
  expect(repo) {
    assert.deepEqual(repo.issue('ISS-3F7H').blocked_by, ['ISS-6J0B'])
    assert.equal(repo.newEvents('ISS-3F7H').filter((event) => event.op === 'link').length, 1)
    // The tracker stores the link once, as blocked_by on the blocked issue. The blocker's side is derived.
    assert.equal(repo.newEvents('ISS-6J0B').length, 0)
  },
}
