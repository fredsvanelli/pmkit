// /pmkit:linear:triage-rotation. The scenario helper runs the real CLI in a child process, so it cannot inject the fake
// Linear fetch. The present path is covered by the CLI tests in scripts/cli-linear.test.mjs. Two entries cover what a child
// process can reach: a Local tracker, where step 1 reads the manifest and the command stops, and a Linear config with no
// LINEAR_API_KEY, where step 1 fails with AUTH before any request.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SKIPPED = 'needs the Linear API, which a child process cannot fake; scripts/cli-linear.test.mjs covers it'
const skip = {
  '2 linear triage show': SKIPPED,
  '4 linear triage suggestions': SKIPPED,
  '6 discover': SKIPPED,
  '6 linear triage set': SKIPPED,
  '7 linear triage set': SKIPPED,
}
const notHit = {
  'Step 5': 'the command stops at step 1 on this tracker, before it asks what to do',
  'Step 6': 'the command stops at step 1 on this tracker, before it previews a change',
}

export default [
  {
    command: 'linear/triage-rotation',
    fixture: 'team',
    git: true,
    prompt: '/pmkit:linear:triage-rotation',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.tracker, 'local')
    },
  },
  {
    command: 'linear/triage-rotation',
    fixture: 'team',
    git: true,
    async setup({ root }) {
      const file = path.join(root, '.pmkit', 'config.yaml')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  system: local\n  path: .issues', '  system: linear\n  scope:\n    workspace: acme'))
    },
    prompt: '/pmkit:linear:triage-rotation',
    answers: [],
    steps: [{ step: '1', read: ['capabilities'], expectError: 'AUTH', save: 'capabilities' }],
    skip,
    notHit,
    expect(repo, saved) {
      assert.equal(saved.capabilities.error.code, 'AUTH')
    },
  },
]
