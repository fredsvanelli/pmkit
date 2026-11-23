// /pmkit:jira:product-discovery. The scenario helper runs the real CLI in a child process, so it cannot inject the fake Jira
// server. The Jira ideas CLI tests (scripts/cli-ideas-jira.test.mjs) and the runbook test cover the present path.
// This entry covers what a child process can reach: a Local tracker, where step 1 reads the manifest and the command stops.
import assert from 'node:assert/strict'

const SKIPPED = 'needs the Jira API, which a child process cannot fake; the Jira ideas CLI tests cover it'
const skip = {
  '2 jira ideas list': SKIPPED,
  '4 jira ideas connect': SKIPPED,
}
const notHit = {
  'Step 2': 'the command stops at step 1 on this tracker, before it asks which project to read',
  'Step 4': 'the command stops at step 1 on this tracker, before it previews a connection',
}

export default [
  {
    command: 'jira/product-discovery',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:jira:product-discovery',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
]
