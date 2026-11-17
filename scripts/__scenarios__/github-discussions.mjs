// /pmkit:github:discussions. The scenario helper runs the real CLI in a child process with no fake gh, so it cannot reach
// GitHub. scripts/cli-discussions-github.test.mjs covers the GitHub path in process, and scripts/runbook-discussions-github.test.mjs
// covers it end to end with a fake gh on PATH. This entry covers what the helper can reach: a Local tracker, where step 1 reads
// the manifest and the command stops.
import assert from 'node:assert/strict'

const SKIPPED = 'needs GitHub, which this child process cannot fake; scripts/runbook-discussions-github.test.mjs covers it'
const skip = {
  '2 github discussions list': SKIPPED,
  '3 github discussions get': SKIPPED,
  '5 issues create': SKIPPED,
  '6 issues create': SKIPPED,
  '7 github discussions comment': SKIPPED,
  '8 github discussions comment': SKIPPED,
}
const notHit = {
  'Step 2': 'the command stops at step 1 on this tracker, before it lists the discussions',
  'Step 4': 'the command stops at step 1 on this tracker, before it asks what to do',
  'Step 5': 'the command stops at step 1 on this tracker, before it previews an issue',
  'Step 7': 'the command stops at step 1 on this tracker, before it previews a comment',
}

export default [
  {
    command: 'github/discussions',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:github:discussions',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
]
