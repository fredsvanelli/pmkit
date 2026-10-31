// /pmkit:issues:security-alerts on the team fixture, which has no package-lock.json or npm-shrinkwrap.json.
// The scan finds no scanner, so the capability is absent: the command says so, names the missing file and stops
// before any create. The create path needs an npm that prints an audit report, which a scenario cannot fake without
// the network, so cli-alerts-scan.test.mjs covers it.
import assert from 'node:assert/strict'

export default {
  command: 'issues/security-alerts',
  fixture: 'team',
  prompt: '/pmkit:issues:security-alerts',
  answers: [],
  steps: [
    { step: '1', read: ['alerts', 'scan'] },
  ],
  skip: {
    '2 discover': 'there is nothing to create when the capability is absent',
    '4 issues create': 'there is nothing to create when the capability is absent',
    '6 issues create': 'there is nothing to create when the capability is absent',
  },
  notHit: {
    'Step 2': 'the scan found no scanner, so no candidate lacks a type or priority',
    'Step 4': 'no dry run runs when the capability is absent',
    'Step 5': 'the command stops at step 1, before the preview',
  },
  expect(repo) {
    assert.equal(repo.newEvents('ISS-Y8KQ').length, 0)
  },
}
