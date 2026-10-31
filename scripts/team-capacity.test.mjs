import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeList, checkMembers, mergeCapacity, parseCapacityPairs, workingDays } from './lib/team-capacity.mjs'

const invalid = /./
const code = (name, pattern = invalid) => (error) => error.code === name && pattern.test(error.message)

test('workingDays counts the weekdays of the sprint minus the days off', () => {
  const sprint = { start: '2026-10-12', end: '2026-10-25' }
  assert.equal(workingDays(sprint, []), 10)
  assert.equal(workingDays(sprint, ['2026-10-16']), 9)
  assert.equal(workingDays(sprint, ['2026-10-16', '2026-10-19']), 8)
})

test('parseCapacityPairs reads numbers and none', () => {
  assert.deepEqual(parseCapacityPairs(['ana=6', 'fred=none', 'zed=2.5']), { ana: 6, fred: null, zed: 2.5 })
})

test('parseCapacityPairs refuses a bad pair and a repeated member', () => {
  assert.throws(() => parseCapacityPairs(['ana=x']), code('INVALID_INPUT', /ana=x/))
  assert.throws(() => parseCapacityPairs(['ana']), code('INVALID_INPUT'))
  assert.throws(() => parseCapacityPairs(['ana=1', 'ana=2']), code('INVALID_INPUT', /twice/))
})

test('mergeCapacity keeps the other members and a null removes one', () => {
  assert.deepEqual(mergeCapacity({ fred: 8, ana: 10 }, { ana: 6 }), { fred: 8, ana: 6 })
  assert.deepEqual(mergeCapacity({ fred: 8 }, { fred: null }), {})
})

test('checkMembers refuses an agent with the delegate next step and an unknown member with the valid list', () => {
  assert.throws(() => checkMembers(['agent:claude'], ['fred']), (error) => error.code === 'INVALID_INPUT' && /agent/.test(error.message) && /issues:delegate/.test(error.nextStep))
  assert.throws(() => checkMembers(['zed'], ['fred', 'ana']), (error) => error.code === 'INVALID_INPUT' && /fred, ana/.test(error.nextStep))
  assert.doesNotThrow(() => checkMembers(['fred'], ['fred', 'ana']))
})

test('changeList lists only the members whose values differ, with null for unset', () => {
  const before = { capacity: { fred: 8, ana: 10 }, daysOff: { ana: ['2026-10-16'] } }
  const after = { capacity: { fred: 8, ana: 12, zed: 3 }, daysOff: { ana: ['2026-10-16'], fred: ['2026-10-14'] } }
  assert.deepEqual(changeList(before, after, ['fred', 'ana', 'zed']), [
    { member: 'fred', capacity: { before: 8, after: 8 }, daysOff: { before: [], after: ['2026-10-14'] } },
    { member: 'ana', capacity: { before: 10, after: 12 }, daysOff: { before: ['2026-10-16'], after: ['2026-10-16'] } },
    { member: 'zed', capacity: { before: null, after: 3 }, daysOff: { before: [], after: [] } },
  ])
})
