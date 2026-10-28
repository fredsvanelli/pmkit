import assert from 'node:assert/strict'
import test from 'node:test'
import { cycleKey, toSprint } from './cycles.mjs'

const node = (extra = {}) => ({
  id: 'cycle-12', number: 12, name: 'Autumn', description: 'Ship it', startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-13T00:00:00.000Z',
  completedAt: null, isActive: false, isFuture: false, isPast: false, ...extra,
})

test('cycleKey accepts a positive whole number in a string', () => {
  assert.equal(cycleKey('12'), 12)
  for (const bad of ['abc', '0', '1.5', '-3', '', '012', 12, null, undefined]) assert.equal(cycleKey(bad), null, String(bad))
})

test('a fractional cycle number is not a valid key', () => {
  assert.equal(cycleKey(String(12.5)), null)
})

test('state comes from the flags: active, planned, closed, and closed for none', () => {
  assert.equal(toSprint(node({ isActive: true })).state, 'active')
  assert.equal(toSprint(node({ isFuture: true })).state, 'planned')
  assert.equal(toSprint(node({ isPast: true })).state, 'closed')
  assert.equal(toSprint(node()).state, 'closed')
})

test('fields: id, name, goal and dates in the Local key order', () => {
  const sprint = toSprint(node({ isActive: true }))
  assert.deepEqual(Object.keys(sprint), ['id', 'name', 'start', 'end', 'goal', 'state', 'capacity', 'daysOff'])
  assert.equal(sprint.id, '12')
  assert.equal(sprint.name, 'Autumn')
  assert.equal(sprint.goal, 'Ship it')
  assert.equal(sprint.start, '2026-11-02')
  assert.equal(sprint.end, '2026-11-12')
})

test('endsAt is an exclusive boundary, so end is the UTC date of the last millisecond before it', () => {
  assert.equal(toSprint(node({ endsAt: '2026-11-13T00:00:00.000Z' })).end, '2026-11-12')
  assert.equal(toSprint(node({ endsAt: '2026-11-13T00:00:00.001Z' })).end, '2026-11-13')
  assert.equal(toSprint(node({ endsAt: '2026-11-13T09:00:00.000Z' })).end, '2026-11-13')
})

test('a null name gives Cycle <number> and a null description an empty goal', () => {
  const sprint = toSprint(node({ name: null, description: null }))
  assert.equal(sprint.name, 'Cycle 12')
  assert.equal(sprint.goal, '')
})

test('closed is set from completedAt only for a closed cycle', () => {
  const at = '2026-11-13T09:00:00.000Z'
  assert.equal(toSprint(node({ isPast: true, completedAt: at })).closed, at)
  assert.equal(toSprint(node({ isPast: true })).closed, undefined)
  assert.equal(toSprint(node({ isActive: true, completedAt: at })).closed, undefined)
})

test('capacity and days off come from the local entry and default to empty maps', () => {
  assert.deepEqual(toSprint(node()).capacity, {})
  assert.deepEqual(toSprint(node()).daysOff, {})
  const sprint = toSprint(node(), { capacity: { u1: 8 }, daysOff: { u1: ['2026-11-03'] } })
  assert.deepEqual(sprint.capacity, { u1: 8 })
  assert.deepEqual(sprint.daysOff, { u1: ['2026-11-03'] })
})
