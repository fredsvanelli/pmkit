// /pmkit:help with no argument on the team fixture: the command reads the capability manifest and nothing else.
import assert from 'node:assert/strict'

export default {
  command: 'help',
  fixture: 'team',
  git: true,
  prompt: '/pmkit:help',
  answers: [],
  steps: [
    { step: '1', read: ['capabilities'], save: 'capabilities' },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(saved.capabilities.tracker, 'local')
    assert.ok(saved.capabilities.capabilities.some((capability) => capability.id === 'cycles'), 'the manifest lists cycles')
  },
}
