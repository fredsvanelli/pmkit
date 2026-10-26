// /pmkit:spec:import .issues/docs/specs/overview.md on the no-sprints fixture, without an epic ID, so the command
// proposes a new epic. The spec has no phases, so the tree has no milestones and no call passes --milestone.
// It has no acceptance criteria either: every issue is marked "needs criteria", and since `needs-criteria` is not
// in the tracker's labels, no create passes --label. The user approves the tree in step 5:
//   new epic  Webhook delivery platform
//   issue     Retry failed deliveries with backoff (feature, 3)
//   issue     Park exhausted deliveries in a dead-letter queue (feature, 5), blocked by the retry issue
//   sub-issue Replay a parked delivery (task, 2), under the dead-letter issue
import assert from 'node:assert/strict'

const epic = ['epic', 'create', '--title', 'Webhook delivery platform']
const retry = ['issues', 'create', '--title', 'Retry failed deliveries with backoff', '--type', 'feature', '--estimate', '3']
const park = ['issues', 'create', '--title', 'Park exhausted deliveries in a dead-letter queue', '--type', 'feature', '--estimate', '5']
const replay = ['issues', 'create', '--title', 'Replay a parked delivery', '--type', 'task', '--estimate', '2']

export default {
  command: 'spec/import',
  fixture: 'no-sprints',
  prompt: '/pmkit:spec:import .issues/docs/specs/overview.md',
  answers: ['Yes'],
  steps: [
    // Steps 1 and 2: the spec, then the allowed values.
    { step: '1', read: ['docs', 'read', 'specs/overview.md'], save: 'spec' },
    { step: '2', read: ['discover'], save: 'discovered' },
    // Steps 3 to 5: the tree is shown and approved once.
    { confirm: 'Step 5' },
    // Step 6: check the epic and the two top-level issues before any write.
    { step: '6', dryRun: epic },
    { step: '6', dryRun: retry },
    { step: '6', dryRun: park },
    // Step 7: the epic. Step 8: the issues under it, then the sub-issue under its parent.
    { step: '7', write: epic, save: 'epic' },
    { step: '8', write: (saved) => [...retry, '--parent', saved.epic.after.id], save: 'retry' },
    { step: '8', write: (saved) => [...park, '--parent', saved.epic.after.id], save: 'park' },
    { step: '8', write: (saved) => [...replay, '--parent', saved.park.after.id], save: 'replay' },
    // Step 9: the retry issue blocks the dead-letter issue.
    { step: '9', write: (saved) => ['issues', 'link', saved.retry.after.id, saved.park.after.id, '--kind', 'blocks'] },
  ],
  skip: {
    '2 epic get': 'no epic ID is given, so the command proposes a new epic',
    '2 issues list': 'no epic ID is given, so there are no existing issues to list',
    '10 docs create': 'the spec is already under the docs/ folder, so step 10 stores nothing',
  },
  notHit: {
    'Step 6': 'every dry run passes, so no value needs correcting',
    'Step 10': 'the spec is already under the docs/ folder',
  },
  expect(repo, saved) {
    assert.match(saved.spec.body, /dead-letter queue/)
    assert.ok(!saved.discovered.labels.includes('needs-criteria'), 'the label is not configured, so no create passes it')
    const epicId = saved.epic.after.id
    assert.equal(repo.epic(epicId).title, 'Webhook delivery platform')
    for (const name of ['retry', 'park']) assert.equal(repo.issue(saved[name].after.id).parent, epicId)
    assert.equal(repo.issue(saved.replay.after.id).parent, saved.park.after.id)
    assert.deepEqual(repo.issue(saved.park.after.id).blocked_by, [saved.retry.after.id])
  },
}
