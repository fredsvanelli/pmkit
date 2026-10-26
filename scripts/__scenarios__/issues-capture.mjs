// /pmkit:issues:capture a failing webhook delivery. The text search finds webhook issues, the user
// creates a new bug anyway, and links it to ISS-5N1R as related.
import assert from 'node:assert/strict'
import path from 'node:path'

const inputs = path.join(import.meta.dirname, '_inputs')
const create = ['issues', 'create', '--title', 'Webhook deliveries are lost on a 5xx answer', '--type', 'bug', '--priority', 'high',
  '--description-file', path.join(inputs, 'description.md'), '--criteria-file', path.join(inputs, 'criteria.md')]
const link = (saved) => ['issues', 'link', saved.created.after.id, 'ISS-5N1R', '--kind', 'related']

export default {
  command: 'issues/capture',
  fixture: 'team',
  prompt: '/pmkit:issues:capture webhook deliveries are lost on a 5xx answer',
  answers: ['Create a new one anyway', 'Yes', 'Yes'],
  steps: [
    { step: '2', read: ['discover'] },
    { step: '4', read: ['issues', 'list', '--text', 'webhook'] },
    { confirm: 'Step 5' },
    { step: '6', dryRun: create },
    { confirm: 'Step 7' },
    { step: '6', write: create, save: 'created' },
    { step: '9', dryRun: link },
    { confirm: 'Step 9' },
    { step: '9', write: link },
  ],
  skip: {},
  notHit: {},
  expect(repo) {
    const bug = repo.issue('ISS-M0GZ')
    assert.equal(bug.type, 'bug')
    assert.deepEqual(bug.related, ['ISS-5N1R'])
    assert.equal(repo.newEvents('ISS-M0GZ').filter((event) => event.op === 'link' && event.field === 'related').length, 1)
  },
}
