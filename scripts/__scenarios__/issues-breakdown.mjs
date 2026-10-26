// /pmkit:issues:breakdown ISS-3F7H into two sub-issues, the first blocking the second.
// ISS-3F7H has no children, so step 1 does not ask. No dry run fails, so step 6 does not ask again.
// The approval of step 5 comes before the dry runs of step 6, and it covers the links of step 8.
import assert from 'node:assert/strict'

const rows = [
  ['Design the empty state guide', '1'],
  ['Build the empty state component', '1'],
]
const create = ([title, estimate]) => ['issues', 'create', '--title', title, '--parent', 'ISS-3F7H', '--type', 'task', '--estimate', estimate]
const blocks = (saved) => ['issues', 'link', saved.first.after.id, saved.second.after.id, '--kind', 'blocks']

export default {
  command: 'issues/breakdown',
  fixture: 'team',
  prompt: '/pmkit:issues:breakdown ISS-3F7H',
  answers: ['Yes'],
  steps: [
    { step: '1', read: ['issues', 'get', 'ISS-3F7H'] },
    { step: '2', read: ['discover'] },
    { confirm: 'Step 5' },
    { step: '6', dryRun: create(rows[0]) },
    { step: '6', dryRun: create(rows[1]) },
    { step: '6', write: create(rows[0]), save: 'first' },
    { step: '6', write: create(rows[1]), save: 'second' },
    { step: '8', write: blocks },
  ],
  skip: {},
  notHit: {
    'Step 1': 'ISS-3F7H has no children, so step 1 does not ask whether to add more',
    'Step 6': 'no dry run fails, so no corrected table is shown again',
  },
  expect(repo) {
    const children = ['ISS-M0GZ', 'ISS-Y8KQ']
    for (const id of children) assert.equal(repo.issue(id).parent, 'ISS-3F7H')
    assert.deepEqual(repo.issue('ISS-Y8KQ').blocked_by, ['ISS-M0GZ'])
    assert.equal(children.flatMap((id) => repo.newEvents(id)).filter((event) => event.op === 'link').length, 1)
  },
}
