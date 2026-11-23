// Tests of the Jira Cycles and Capacity families (listCycles, openCycle, closeCycle, the capacity file) over the stateful fake Jira,
// through the tracker that gives them their context.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FAKE_ENV, TRACKER, fakeJiraFetch } from '../../fake-jira-api.mjs'
import { fakeJiraIssues } from '../../fake-jira-issues.mjs'
import { tempDir, userStoreEnv } from '../../test-helpers.mjs'
import { checkMoveInput, moveTargetIn } from '../cycle-moves.mjs'
import { createJiraTracker } from './tracker.mjs'

globalThis.fetch = () => {
  throw new Error('the real fetch was called')
}

const NOW = () => new Date('2026-11-22T12:00:00Z')
const ME = 'acc-1'
const AGILE = '/rest/agile/1.0'
const ACTIVE = { id: 1, state: 'active', name: 'Sprint 1', startDate: '2026-11-16T12:00:00.000Z', endDate: '2026-11-27T12:00:00.000Z' }
const UNDATED = { id: 2, state: 'future', name: 'Sprint 2' }

/** A tracker over a fresh fake; `routes` wrap or replace the fake's routes, given the fake. */
function setup({ sprints, routes = () => ({}) } = {}) {
  const fake = fakeJiraIssues({ requireResolution: false, sprints })
  const fetch = fakeJiraFetch({ ...fake.routes, ...routes(fake) })
  const config = { root: tempDir(), pmkit: { version: 1, tracker: TRACKER, mappings: { types: { story: 'Story' } } } }
  const tracker = createJiraTracker(config, { env: { ...FAKE_ENV, ...userStoreEnv().env }, now: NOW, fetch })
  return { fake, tracker }
}

const sent = (fake) => fake.writes().map((write) => `${write.method} ${write.path}`)

test('openCycle starting today creates the sprint, then starts it; a dry run sends nothing', async () => {
  const { fake, tracker } = setup()
  const dry = await tracker.openCycle({ start: '2026-11-22' }, ME, { dryRun: true })
  assert.deepEqual(dry, { before: null, after: { id: null, name: 'Sprint 2026-11-22', start: '2026-11-22', end: '2026-12-05', goal: '', state: 'active', capacity: {}, daysOff: {} } })
  assert.deepEqual(sent(fake), [])
  const { before, after } = await tracker.openCycle({ start: '2026-11-22', goal: 'Ship it' }, ME)
  assert.equal(before, null)
  assert.deepEqual(after, { id: '1', name: 'Sprint 2026-11-22', start: '2026-11-22', end: '2026-12-05', goal: 'Ship it', state: 'active', capacity: {}, daysOff: {} })
  assert.deepEqual(sent(fake), [`POST ${AGILE}/sprint`, `POST ${AGILE}/sprint/1`])
  assert.deepEqual(fake.writes()[0].body, { name: 'Sprint 2026-11-22', originBoardId: 1, startDate: '2026-11-22T12:00:00.000Z', endDate: '2026-12-05T12:00:00.000Z', goal: 'Ship it' })
  assert.deepEqual(fake.writes()[1].body, { state: 'active' })
  assert.equal((await tracker.currentCycle()).id, '1')
})

test('openCycle in the future only creates the sprint, planned, with the default length', async () => {
  const { fake, tracker } = setup()
  const { after } = await tracker.openCycle({ start: '2026-12-07', name: 'December' }, ME)
  assert.equal(after.state, 'planned')
  assert.equal(after.end, '2026-12-20')
  assert.equal(after.name, 'December')
  assert.deepEqual(sent(fake), [`POST ${AGILE}/sprint`])
})

test('openCycle checks its input and refuses an overlap with the active sprint, sending nothing', async () => {
  const { fake, tracker } = setup({ sprints: [ACTIVE, UNDATED] })
  await assert.rejects(tracker.openCycle({ start: '2026-11-22' }, ME), { code: 'INVALID_INPUT', message: 'sprint 2026-11-22 to 2026-12-05 overlaps 1 (2026-11-16 to 2026-11-27)' })
  await assert.rejects(tracker.openCycle({ start: '2026-11-22', team: 'x' }, ME), { code: 'INVALID_INPUT', message: 'unknown field "team"' })
  await assert.rejects(tracker.openCycle({ start: 'soon' }, ME), { code: 'INVALID_INPUT', message: 'start must be a date as YYYY-MM-DD' })
  await assert.rejects(tracker.openCycle({ start: '2026-12-07', end: '2026-12-01' }, ME), { code: 'INVALID_INPUT', message: 'start 2026-12-07 is after end 2026-12-01' })
  await assert.rejects(tracker.openCycle({ start: '2026-12-07', name: 'a\nb' }, ME), { code: 'INVALID_INPUT', message: 'name must not contain a line break' })
  await assert.rejects(tracker.openCycle({ start: '2026-12-07' }, 'someone-else'), { code: 'INVALID_INPUT' })
  assert.deepEqual(sent(fake), [])
  // A sprint after the active one opens planned.
  assert.equal((await tracker.openCycle({ start: '2026-11-28' }, ME)).after.state, 'planned')
})

test('a start Jira refuses after the create is UPSTREAM naming the created sprint', async () => {
  const { tracker } = setup({
    routes: (fake) => {
      const update = fake.routes[`POST ${AGILE}/sprint/{sprintId}`]
      return { [`POST ${AGILE}/sprint/{sprintId}`]: (call) => (JSON.parse(call.body).state === 'active' ? { status: 400, json: { errorMessages: ['No.'] } } : update(call)) }
    },
  })
  await assert.rejects(tracker.openCycle({ start: '2026-11-22' }, ME), (error) =>
    error.code === 'UPSTREAM' && error.message.startsWith('Jira created sprint 1, but starting it failed: ') && error.details.created === '1' && error.nextStep === 'Start the sprint on the board in Jira')
  assert.deepEqual((await tracker.listCycles()).map((sprint) => [sprint.id, sprint.state]), [['1', 'planned']])
})

test('closeCycle closes the active sprint and returns its unfinished issues; a dry run sends nothing', async () => {
  const { fake, tracker } = setup({ sprints: [ACTIVE, UNDATED] })
  const open = (await tracker.createIssue({ title: 'Open' }, ME)).after.id
  const done = (await tracker.createIssue({ title: 'Done' }, ME)).after.id
  await tracker.moveToCycle([open, done], '1', ME)
  await tracker.moveToCategory(done, 'done', ME)
  const writes = fake.writes().length

  const dry = await tracker.closeCycle('1', ME, { dryRun: true })
  assert.equal(dry.sprint.state, 'closed')
  assert.equal(dry.sprint.closed, '2026-11-22T12:00:00.000Z')
  assert.equal(fake.writes().length, writes)

  const closed = await tracker.closeCycle('1', ME)
  assert.equal(closed.sprint.state, 'closed')
  assert.equal(typeof closed.sprint.closed, 'string')
  assert.deepEqual(closed.unfinished.map((issue) => issue.id), [open])
  assert.deepEqual(closed.problems, [])
  assert.deepEqual(sent(fake).slice(writes), [`POST ${AGILE}/sprint/1`])
  assert.equal(await tracker.currentCycle(), null)
})

test('closeCycle of a planned sprint is INVALID_INPUT, of an unknown one NOT_FOUND', async () => {
  const { fake, tracker } = setup({ sprints: [ACTIVE, UNDATED] })
  await assert.rejects(tracker.closeCycle('2', ME), { code: 'INVALID_INPUT', message: 'sprint 2 is not active (it is planned)' })
  await assert.rejects(tracker.closeCycle('99', ME), { code: 'NOT_FOUND' })
  await assert.rejects(tracker.closeCycle('soon', ME), { code: 'NOT_FOUND' })
  assert.deepEqual(sent(fake), [])
})

test('listCycles lists the board sprints in id order with their capacity, and filters by state', async () => {
  const { tracker } = setup({ sprints: [UNDATED, ACTIVE] })
  assert.deepEqual((await tracker.listCycles()).map((sprint) => sprint.id), ['1', '2'])
  assert.deepEqual((await tracker.listCycles({ state: 'planned' })).map((sprint) => sprint.id), ['2'])
  await assert.rejects(tracker.listCycles({ state: 'open' }), { code: 'INVALID_INPUT' })
  await tracker.setCapacity('1', { 'acc-1': 8 }, ME)
  assert.deepEqual((await tracker.listCycles({ state: 'active' }))[0].capacity, { 'acc-1': 8 })
  await assert.rejects(tracker.getCapacity('99'), { code: 'NOT_FOUND' })
})

test('days off on a sprint without dates is INVALID_INPUT; its capacity is still kept', async () => {
  const { fake, tracker } = setup({ sprints: [ACTIVE, UNDATED] })
  await assert.rejects(tracker.updateCycleCapacity('2', { daysOff: { 'acc-1': ['2026-11-23'] } }, ME), {
    code: 'INVALID_INPUT', message: 'sprint 2 has no dates in Jira', nextStep: "Set the sprint's dates in Jira",
  })
  await tracker.setCapacity('2', { 'acc-1': 5 }, ME)
  assert.deepEqual(await tracker.getCapacity('2'), { 'acc-1': 5 })
  assert.deepEqual(await tracker.getDaysOff('2'), {})
  assert.deepEqual(sent(fake), [])
})

test('a space whose only board is Kanban has no sprints', async () => {
  const kanban = { 'GET /rest/agile/1.0/board': { json: { startAt: 0, maxResults: 50, total: 1, isLast: true, values: [{ id: 2, name: 'ENG kanban', type: 'kanban' }] } } }
  const { tracker } = setup({ routes: () => kanban })
  await assert.rejects(tracker.listCycles(), { code: 'NOT_SUPPORTED', message: 'Sprints need a Scrum board in space ENG', nextStep: 'Sprints need a Scrum board in space ENG' })
  await assert.rejects(tracker.openCycle({ start: '2026-11-22' }, ME), { code: 'NOT_SUPPORTED' })
})

// The shared helpers of scripts/lib/cycle-moves.mjs, which GitHub and Jira both call; cycle-moves has no test file of its own.
test('moveTargetIn picks the target of a move; checkMoveInput checks ids and to', () => {
  const sprints = [{ id: '1', state: 'closed' }, { id: '2', state: 'active' }, { id: '3', state: 'planned' }]
  assert.equal(moveTargetIn(sprints, null), null)
  assert.equal(moveTargetIn(sprints, 'current').id, '2')
  assert.equal(moveTargetIn(sprints, '3').id, '3')
  assert.throws(() => moveTargetIn([], 'current'), { code: 'INVALID_INPUT', message: 'there is no active sprint', nextStep: 'pmkit cycle list' })
  assert.throws(() => moveTargetIn(sprints, 'none'), { code: 'INVALID_INPUT', message: 'sprint none does not exist', nextStep: 'pmkit cycle list' })
  assert.throws(() => moveTargetIn(sprints, '1'), { code: 'CONFLICT' })
  assert.throws(() => checkMoveInput([], null), { code: 'INVALID_INPUT', message: 'ids must be a non-empty list' })
  assert.throws(() => checkMoveInput(['ENG-1'], 3), { code: 'INVALID_INPUT', message: 'to must be a sprint id, current or null' })
  assert.doesNotThrow(() => checkMoveInput(['ENG-1'], 'current'))
})
