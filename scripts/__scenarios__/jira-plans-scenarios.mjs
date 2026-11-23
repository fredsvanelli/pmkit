// /pmkit:jira:plans-scenarios. The scenario helper runs the real CLI in a child process, so it cannot inject the fake Jira
// server. the Jira plans CLI tests cover the present path.
// This entry covers what a child process can reach: a Local tracker, where step 1 reads the manifest and the command stops.
import assert from 'node:assert/strict'

const SKIPPED = 'needs the Jira API, which a child process cannot fake; the Jira plans CLI tests cover it'
const skip = {
  '2 jira plans list': SKIPPED,
  '4 jira plans get': SKIPPED,
}
const notHit = {
  'Step 3': 'the command stops at step 1 on this tracker, before it asks which plan to open',
}

export default [
  {
    command: 'jira/plans-scenarios',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:jira:plans-scenarios',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
]
