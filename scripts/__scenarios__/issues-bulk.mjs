// /pmkit:issues:bulk priority urgent --category done,in_review --type feature on the no-sprints fixture.
// Three issues match (ISS-2K5P medium, ISS-6R3N high, ISS-9B2X high) and all three change. The user sees the full preview with its
// digest and approves, and the write passes the digest back, so it can only write the set the user saw.
import assert from 'node:assert/strict'

const FILTER = ['--category', 'done,in_review', '--type', 'feature']

export default {
  command: 'issues/bulk',
  fixture: 'no-sprints',
  prompt: '/pmkit:issues:bulk priority urgent --category done,in_review --type feature',
  answers: ['Apply'],
  steps: [
    { step: '2', read: ['issues', 'list', ...FILTER] },
    { step: '3', dryRun: ['issues', 'bulk', 'priority', 'urgent', ...FILTER], save: 'preview' },
    { confirm: 'Step 6' },
    { step: '7', write: (saved) => ['issues', 'bulk', 'priority', 'urgent', ...FILTER, '--expect', saved.preview.digest] },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.deepEqual(saved.preview.items.map((item) => [item.id, item.state]), [['ISS-2K5P', 'change'], ['ISS-6R3N', 'change'], ['ISS-9B2X', 'change']])
    assert.match(saved.preview.digest, /^sha256:[0-9a-f]{64}$/)
    for (const id of ['ISS-2K5P', 'ISS-6R3N', 'ISS-9B2X']) {
      assert.equal(repo.issue(id).priority, 'urgent')
      assert.equal(repo.newEvents(id).length, 1)
    }
    assert.equal(repo.issue('ISS-3M8D').priority, 'medium')
    assert.equal(repo.newEvents('ISS-3M8D').length, 0)
  },
}
