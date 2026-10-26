// /pmkit:issues:create with a title and four fields. --sprint puts the issue in a sprint,
// which always asks for confirmation. The CLI takes a sprint ID, not the word "current".
import assert from 'node:assert/strict'

const args = ['issues', 'create', '--title', 'Add a health check endpoint', '--type', 'task', '--priority', 'high', '--estimate', '3', '--sprint', '2026-10-12']

export default {
  command: 'issues/create',
  fixture: 'team',
  prompt: '/pmkit:issues:create Add a health check endpoint',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['discover'] },
    { step: '4', dryRun: args },
    { confirm: 'Step 5' },
    { step: '4', write: args },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const created = repo.issue('ISS-M0GZ')
    assert.equal(created.title, 'Add a health check endpoint')
    assert.equal(created.sprint, '2026-10-12')
    assert.deepEqual([created.type, created.priority, created.estimate], ['task', 'high', 3])
  },
}
