// /pmkit:cycle:plan on the team fixture. No sprint is planned, so step 1 does not ask. The active sprint 2026-10-12
// ends on 2026-10-25, so the next one runs from Monday 2026-10-26 to 2026-11-08 (14 days). The user approves the
// capacity fred=8, ana=6. The scope is every todo or backlog issue without a sprint: ISS-3F7H (2 points) and ISS-6J0B,
// which has no estimate and is flagged as a risk. The sprint ID comes from the saved result of cycle open.
import assert from 'node:assert/strict'

const goal = 'Dashboard empty state and build tooling'
const open = ['cycle', 'open', '--start', '2026-10-26', '--end', '2026-11-08', '--goal', goal]
const add = (saved) => ['cycle', 'add', ...saved.scope.issues.map((issue) => issue.id), '--to', saved.sprint.after.id]

export default {
  command: 'cycle/plan',
  fixture: 'team',
  prompt: `/pmkit:cycle:plan ${goal}`,
  answers: ['No days off for anyone', 'Yes, fred=8 and ana=6', 'Yes'],
  steps: [
    // Step 1: the sprints and the members.
    { step: '1', read: ['cycle', 'list'] },
    { step: '1', read: ['discover'] },
    // Step 3: velocity from the last 3 sprints.
    { step: '3', read: ['metrics', 'velocity', '--window', '3'], save: 'velocity' },
    // Step 5: the draft scope.
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog', '--sprint', 'none'], save: 'scope' },
    // Steps 6 and 7: approve the capacity inputs, then open the sprint and set the capacity.
    { confirm: 'Step 6' },
    { step: '7', dryRun: open },
    { step: '7', write: open, save: 'sprint' },
    { step: '7', write: (saved) => ['cycle', 'capacity', saved.sprint.after.id, '--set', 'fred=8,ana=6'] },
    // Steps 8 and 9: preview the scope, approve it, then add the issues.
    { step: '8', dryRun: add },
    { confirm: 'Step 8' },
    { step: '8', write: add },
  ],
  skip: {},
  notHit: { 'Step 1': 'the team fixture has no planned sprint, so step 1 does not ask whether to plan one' },
  expect(repo, saved) {
    assert.equal(saved.velocity.average, 10, 'the plan says the velocity comes from one closed sprint')
    assert.deepEqual(saved.scope.issues.map((issue) => issue.id), ['ISS-3F7H', 'ISS-6J0B'])
    const sprint = repo.sprint('2026-10-26')
    assert.equal(sprint.goal, goal)
    assert.equal(sprint.end, '2026-11-08')
    assert.deepEqual(sprint.capacity, { fred: 8, ana: 6 })
    for (const id of ['ISS-3F7H', 'ISS-6J0B']) assert.equal(repo.issue(id).sprint, '2026-10-26')
  },
}
