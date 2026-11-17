// /pmkit:github:draft-issues. The scenario helper runs the real CLI in a child process with no fake gh, so it cannot reach
// GitHub. scripts/cli-draft-issues-github.test.mjs covers the GitHub path in process, and scripts/runbook-draft-issues-github.test.mjs
// covers it end to end with a fake gh on PATH. This entry covers what the helper can reach: a Local tracker, where step 1 reads
// the manifest and the command stops.
import assert from 'node:assert/strict'

const SKIPPED = 'needs GitHub, which this child process cannot fake; scripts/runbook-draft-issues-github.test.mjs covers it'
const skip = {
  '2 github draft-issues list': SKIPPED,
  '4 github draft-issues convert': SKIPPED,
  '5 github draft-issues convert': SKIPPED,
  '6 discover': SKIPPED,
  '6 issues update': SKIPPED,
}
const notHit = {
  'Step 3': 'the command stops at step 1 on this tracker, before it asks which drafts to convert',
  'Step 4': 'the command stops at step 1 on this tracker, before it previews a conversion',
  'Step 6': 'the command stops at step 1 on this tracker, before it previews the fields',
}

export default [
  {
    command: 'github/draft-issues',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:github:draft-issues',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
]
