// /pmkit:cycle:plan on the team fixture. No sprint is planned, so step 1 does not ask. The active sprint 2026-10-12
// ends on 2026-10-25, so the next one runs from Monday 2026-10-26 to 2026-11-08 (14 days). The formula of step 4
// gives fred=6 and ana=4 (velocity 10, 10 working days, availability 1 and 0.8); in step 6 the user raises them to
// fred=8 and ana=6. The scope is every todo, backlog, in_progress or in_review issue without a sprint; setup adds
// Review the retry policy (in_review, 2 points, no sprint), which a sprint close leaves that way (PMK-164). Setup links two
// blockers: ISS-5N1R blocks ISS-6J0B and is in the selection, and ISS-8C4W (in_review, in the active sprint)
// blocks ISS-3F7H. Step 5 reads ISS-8C4W, the one blocker outside its list, and leaves ISS-3F7H out because
// ISS-8C4W is open and not selected. Capacity 14 covers 3 + 1 points, and ISS-6J0B has no estimate and is flagged
// as a risk. The sprint ID comes from the saved result of cycle open.
import assert from 'node:assert/strict'

const goal = 'Dashboard empty state and build tooling'
const open = ['cycle', 'open', '--start', '2026-10-26', '--end', '2026-11-08', '--goal', goal]
// Step 5 leaves ISS-3F7H out for its open blocker ISS-8C4W.
const scope = (saved) => saved.scope.issues.map((issue) => issue.id).filter((id) => id !== 'ISS-3F7H')
const add = (saved) => ['cycle', 'add', ...scope(saved), '--to', saved.sprint.after.id]

const fromScratch = {
  command: 'cycle/plan',
  fixture: 'team',
  prompt: `/pmkit:cycle:plan ${goal}`,
  answers: ['No days off for anyone', 'Change the capacity to fred=8 and ana=6, then yes', 'Yes'],
  // A sprint close sends ISS-5N1R (in_progress) and ISS-4M2S back to no sprint.
  async setup({ pmkit }) {
    await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none'])
    await pmkit(['issues', 'link', 'ISS-5N1R', 'ISS-6J0B', '--kind', 'blocks'])
    await pmkit(['issues', 'link', 'ISS-8C4W', 'ISS-3F7H', '--kind', 'blocks'])
    const review = await pmkit(['issues', 'create', '--title', 'Review the retry policy', '--estimate', '2'])
    await pmkit(['issues', 'move', review.after.id, 'in_review'])
  },
  steps: [
    // Step 1: the sprints and the members.
    { step: '1', read: ['cycle', 'list'] },
    { step: '1', read: ['discover'] },
    // Step 3: velocity from the last 3 sprints.
    { step: '3', read: ['metrics', 'velocity', '--window', '3'], save: 'velocity' },
    // Step 5: the draft scope.
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress,in_review', '--sprint', 'none'], save: 'scope' },
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress,in_review', '--sprint', 'none', '--blocked'], save: 'blocked' },
    // ISS-8C4W blocks ISS-3F7H and is not in the first list. ISS-5N1R blocks ISS-6J0B but is in the first list.
    { step: '5', read: ['issues', 'get', 'ISS-8C4W'], save: 'blocker' },
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
    // The in_review issue of setup comes last: it was created after the fixture's issues.
    const review = saved.scope.issues.at(-1)
    assert.deepEqual([review.title, review.status.category], ['Review the retry policy', 'in_review'])
    assert.deepEqual(saved.scope.issues.slice(0, -1).map((issue) => issue.id), ['ISS-5N1R', 'ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S'])
    assert.equal(repo.issue(review.id).sprint, '2026-10-26', 'step 9 plans the sprintless in_review issue')
    assert.deepEqual(saved.blocked.issues.map((issue) => issue.id), ['ISS-3F7H', 'ISS-6J0B'])
    assert.equal(saved.blocker.status.category, 'in_review', 'ISS-8C4W is open, so ISS-3F7H stays out')
    assert.equal(repo.issue('ISS-3F7H').sprint, undefined, 'step 5 leaves out ISS-3F7H for its open blocker')
    for (const id of ['ISS-5N1R', 'ISS-6J0B', 'ISS-4M2S']) assert.equal(repo.issue(id).sprint, '2026-10-26')
  },
}

// PMK-162: step 1 plans an existing planned sprint, and step 5 counts a blocker that is already in it as selected.
// Setup opens 2026-10-26 (planned, since 2026-10-12 is active), sends ISS-5N1R and ISS-4M2S back to no sprint as a close
// would, links ISS-5N1R to block ISS-6J0B and moves ISS-5N1R into the planned sprint. Step 5 reads ISS-5N1R, which is
// not in its list because it has a sprint, finds it in the chosen sprint and keeps ISS-6J0B in the scope.
const planned = '2026-10-26'
// Nothing else is blocked here, and 3 points fit the capacity of 14, so step 5 keeps the whole list.
const plannedScope = (saved) => saved.scope.issues.map((issue) => issue.id)
const addToPlanned = (saved) => ['cycle', 'add', ...plannedScope(saved), '--to', planned]

const existingPlanned = {
  command: 'cycle/plan',
  fixture: 'team',
  prompt: '/pmkit:cycle:plan',
  answers: ['Yes, plan 2026-10-26', 'No days off for anyone', 'Change the capacity to fred=8 and ana=6, then yes', 'Yes'],
  async setup({ pmkit }) {
    await pmkit(['cycle', 'open', '--start', planned, '--end', '2026-11-08', '--goal', 'Retry policy'])
    await pmkit(['cycle', 'add', 'ISS-5N1R', 'ISS-4M2S', '--to', 'none'])
    await pmkit(['issues', 'link', 'ISS-5N1R', 'ISS-6J0B', '--kind', 'blocks'])
    await pmkit(['cycle', 'add', 'ISS-5N1R', '--to', planned])
  },
  steps: [
    // Step 1: the planned sprint exists, so step 1 asks whether to plan it.
    { step: '1', read: ['cycle', 'list'], save: 'sprints' },
    { step: '1', read: ['discover'] },
    { confirm: 'Step 1' },
    { step: '3', read: ['metrics', 'velocity', '--window', '3'] },
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress,in_review', '--sprint', 'none'], save: 'scope' },
    { step: '5', read: ['issues', 'list', '--category', 'todo,backlog,in_progress,in_review', '--sprint', 'none', '--blocked'], save: 'blocked' },
    // ISS-5N1R blocks ISS-6J0B and is not in the first list: its sprint is the chosen one, so it counts as selected.
    { step: '5', read: ['issues', 'get', 'ISS-5N1R'], save: 'blocker' },
    // Steps 6 and 7: the sprint exists, so step 7 sets its capacity and opens nothing.
    { confirm: 'Step 6' },
    { step: '7', write: ['cycle', 'capacity', planned, '--set', 'fred=8,ana=6'] },
    { step: '8', dryRun: addToPlanned },
    { confirm: 'Step 8' },
    { step: '8', write: addToPlanned },
  ],
  skip: {},
  notHit: {},
  expect(repo, saved) {
    assert.equal(saved.sprints.find((sprint) => sprint.id === planned).state, 'planned')
    assert.deepEqual([saved.blocker.sprint, saved.blocker.status.category], [planned, 'in_progress'], 'the blocker is open and in the chosen sprint')
    assert.ok(saved.blocked.issues.some((issue) => issue.id === 'ISS-6J0B'), 'ISS-6J0B has an open blocker')
    assert.deepEqual(plannedScope(saved), ['ISS-3F7H', 'ISS-6J0B', 'ISS-4M2S'], 'the blocker counts as selected, so ISS-6J0B stays in the scope')
    for (const id of ['ISS-5N1R', 'ISS-6J0B']) assert.equal(repo.issue(id).sprint, planned, `${id} is in the planned sprint`)
    assert.deepEqual(repo.sprint(planned).capacity, { fred: 8, ana: 6 })
    assert.equal(repo.sprint(planned).goal, 'Retry policy', 'the existing sprint keeps its goal')
  },
}

export default [fromScratch, existingPlanned]
