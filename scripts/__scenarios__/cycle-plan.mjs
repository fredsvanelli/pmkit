// /pmkit:cycle:plan on the team fixture. No sprint is planned, so step 1 does not ask. The active sprint 2026-10-12
// ends on 2026-10-25, so the next one runs from Monday 2026-10-26 to 2026-11-08 (14 days). The formula of step 4
// gives fred=6 and ana=4 (velocity 10, 10 working days, availability 1 and 0.8); in step 6 the user raises them to
// fred=8 and ana=6. The scope is every todo, backlog or in_progress issue without a sprint. Capacity 14 covers
// 3 + 2 + 1 points, and ISS-6J0B has no estimate and is flagged as a risk. The sprint ID comes from the saved
// result of cycle open.
import assert from 'node:assert/strict'

const goal = 'Dashboard empty state and build tooling'
const open = ['cycle', 'open', '--start', '2026-10-26', '--end', '2026-11-08', '--goal', goal]
const add = (saved) => ['cycle', 'add', ...saved.scope.issues.map((issue) => issue.id), '--to', saved.sprint.after.id]

export default {
  command: 'cycle/plan',
  fixture: 'team',
  prompt: `/pmkit:cycle:plan ${goal}`,
  answers: ['No days off for anyone', 'Change the capacity to fred=8 and ana=6, then yes', 'Yes'],
  // A sprint close sends ISS-5N1R (in_progress) and ISS-4M2S back to no sprint.
  async setup({ pmkit }) { await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none']) },
  steps: [
    // Step 1: the sprints and the members.
    { step: '1', read: ['cycle', 'list'] },
    { step: '1', read: ['discover'] },
    // Step 3: velocity from the last 3 sprints.
    { step: '3', read: ['metrics', 'velocity', '--window', '3'], save: 'velocity' },
    // Step 5: the draft scope.
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress', '--sprint', 'none'], save: 'scope' },
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
    const sprint = repo.sprint('2026-10-26')
    assert.equal(sprint.goal, goal)
    assert.equal(sprint.end, '2026-11-08')
    assert.deepEqual(sprint.capacity, { fred: 8, ana: 6 })
    assert.equal(saved.velocity.average, 10, 'the plan says the velocity comes from one closed sprint')
    // The order is the CLI's creation order (10-05, 10-07, 10-08, 10-13).
    assert.deepEqual(saved.scope.issues.map((issue) => issue.id), ['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S'])
    for (const id of ['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S']) assert.equal(repo.issue(id).sprint, '2026-10-26')
  },
}
