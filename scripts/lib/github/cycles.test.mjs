import assert from 'node:assert/strict'
import test from 'node:test'
import { appendIteration, ITERATION_FIELD_QUERY, iterationEnd, iterationState, sprintsOf, toSprint, UPDATE_ITERATIONS } from './cycles.mjs'

const current = { id: 'I2', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 }
const done = { id: 'I1', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 }

test('iterationEnd is the start plus the duration minus one day', () => {
  assert.equal(iterationEnd(current), '2026-11-29')
})

test('iterationState follows the dates and the completed list', () => {
  assert.equal(iterationState(current, { completed: false, today: '2026-11-16' }), 'active')
  assert.equal(iterationState(current, { completed: false, today: '2026-11-29' }), 'active')
  assert.equal(iterationState(current, { completed: false, today: '2026-11-15' }), 'planned')
  assert.equal(iterationState(current, { completed: true, today: '2026-11-16' }), 'closed')
})

test('toSprint builds the sprint shape with the capacity entry', () => {
  const entry = { capacity: { ana: 5 }, daysOff: { ana: ['2026-11-20'] } }
  assert.deepEqual(toSprint(current, { completed: false, today: '2026-11-17', entry }), {
    id: '2026-11-16', name: 'Sprint 2', start: '2026-11-16', end: '2026-11-29', goal: '', state: 'active', capacity: entry.capacity, daysOff: entry.daysOff,
  })
  assert.deepEqual(toSprint(current, { completed: false, today: '2026-11-17' }).capacity, {})
})

test('sprintsOf lists completed and current iterations in start order', () => {
  const { sprints, warnings } = sprintsOf({ iterations: [current], completedIterations: [done] }, '2026-11-17')
  assert.deepEqual(sprints.map((sprint) => [sprint.id, sprint.state]), [['2026-11-02', 'closed'], ['2026-11-16', 'active']])
  assert.deepEqual(warnings, [])
})

test('sprintsOf keeps the first of two iterations with one start date and warns', () => {
  const twin = { id: 'I3', title: 'Twin', startDate: '2026-11-16', duration: 7 }
  const { sprints, warnings } = sprintsOf({ iterations: [current, twin], completedIterations: [] }, '2026-11-17')
  assert.equal(sprints.length, 1)
  assert.equal(sprints[0].name, 'Sprint 2')
  assert.deepEqual(warnings, ['two iterations start on 2026-11-16; pmkit shows the first'])
})

test('appendIteration keeps every completed and current iteration and adds the new one', () => {
  const result = appendIteration({ duration: 14, startDay: 1, iterations: [current], completedIterations: [done] }, { start: '2026-11-30', end: '2026-12-06', name: 'Sprint 3' })
  assert.deepEqual(result, {
    startDate: '2026-11-02',
    duration: 14,
    iterations: [
      { id: 'I1', title: 'Sprint 1', startDate: '2026-11-02', duration: 14 },
      { id: 'I2', title: 'Sprint 2', startDate: '2026-11-16', duration: 14 },
      { title: 'Sprint 3', startDate: '2026-11-30', duration: 7 },
    ],
  })
})

test('appendIteration on an empty field starts at the new iteration', () => {
  const result = appendIteration({ duration: 14, iterations: [], completedIterations: [] }, { start: '2026-11-16', end: '2026-11-29', name: 'First' })
  assert.deepEqual(result, { startDate: '2026-11-16', duration: 14, iterations: [{ title: 'First', startDate: '2026-11-16', duration: 14 }] })
})

test('the documents start with their operation', () => {
  assert.match(ITERATION_FIELD_QUERY, /^query PmkitIterationField\(\$project: ID!, \$field: String!\)/)
  assert.match(UPDATE_ITERATIONS, /^mutation PmkitUpdateIterations\(\$input: UpdateProjectV2FieldInput!\)/)
})

test('an iteration past its end date that GitHub still lists as current reads closed', () => {
  const { sprints } = sprintsOf({ iterations: [current], completedIterations: [] }, '2026-11-30')
  assert.deepEqual(sprints.map((sprint) => [sprint.id, sprint.state]), [['2026-11-16', 'closed']])
})
