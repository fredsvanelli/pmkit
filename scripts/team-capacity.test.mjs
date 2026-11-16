import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeList, checkMembers, parseCapacityPairs, recomputeCapacity, teamMembers, workingDays } from './lib/team-capacity.mjs'
import { teamLoad } from './lib/team-load.mjs'

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

test('workingDays ignores repeated days off, weekends and dates outside the sprint', () => {
  const sprint = { start: '2026-10-12', end: '2026-10-25' }
  assert.equal(workingDays(sprint, ['2026-10-16', '2026-10-16']), 9)
  assert.equal(workingDays(sprint, ['2026-10-17', '2026-10-18']), 10)
  assert.equal(workingDays(sprint, ['2026-10-09', '2026-10-26']), 10)
  assert.equal(workingDays(sprint, ['2026-10-16', '2026-10-17', '2026-11-02', '2026-10-16']), 9)
})

const week2 = { start: '2026-10-12', end: '2026-10-25' }
// The ten weekdays of week2, in order: `off(k)` takes the first k of them, so a member has 10 - k working days.
const WEEKDAYS = ['10-12', '10-13', '10-14', '10-15', '10-16', '10-19', '10-20', '10-21', '10-22', '10-23'].map((day) => `2026-${day}`)
const off = (k) => WEEKDAYS.slice(0, k)
/** What the store holds after a call: the capacity map and the base map with the patches applied (null drops a base). */
const store = ({ capacity, base = {} }, result) => {
  const next = { capacity: { ...capacity, ...result.patch }, base: { ...base, ...result.basePatch } }
  for (const [member, entry] of Object.entries(next.base)) if (entry === null) delete next.base[member]
  return next
}
const step = (state, member, from, to, set = {}) => store(state, recomputeCapacity(week2, state.capacity, state.base, { [member]: off(from) }, { [member]: off(to) }, set))

test('recomputeCapacity scales a capacity by the working days a member gains or loses, as a patch of that member only', () => {
  const result = recomputeCapacity(week2, { ana: 10, bob: 5 }, {}, {}, { ana: off(1) }, {})
  assert.deepEqual(result.patch, { ana: 9 })
  assert.deepEqual(result.basePatch, { ana: { capacity: 10, workingDays: 10 } })
  assert.deepEqual(result.recomputed, [{ member: 'ana', workingDays: { before: 10, after: 9 }, capacity: { before: 10, after: 9 } }])
  assert.deepEqual(recomputeCapacity(week2, { ana: 7.5 }, {}, {}, { ana: off(1) }, {}).patch, { ana: 6.75 })
})

test('recomputeCapacity leaves a member that --set names, one with no capacity, and one whose days off did not change', () => {
  const after = { ana: off(1), fred: off(1), zed: off(1), bob: [] }
  const result = recomputeCapacity(week2, { ana: 10, zed: 10, bob: 10 }, {}, {}, after, { ana: 4 })
  assert.deepEqual(result.patch, { zed: 9 })
  assert.deepEqual(result.recomputed.map((item) => item.member), ['zed'])
  assert.equal(recomputeCapacity(week2, { ana: 10 }, {}, { ana: off(1) }, { ana: off(1) }, {}).recomputed.length, 0)
})

test('recomputeCapacity goes back to exactly the capacity the user gave, for 3600 capacities and working-day pairs', () => {
  let cases = 0
  for (let capacity = 1; capacity <= 40; capacity++) {
    for (let from = 0; from <= 9; from++) {
      for (let to = 0; to <= 9; to++) {
        if (to === from) continue
        const gone = step({ capacity: { fred: capacity }, base: {} }, 'fred', from, to)
        const back = step(gone, 'fred', to, from)
        assert.deepEqual(back, { capacity: { fred: capacity }, base: {} }, `${capacity} from ${10 - from} to ${10 - to} working days and back`)
        cases++
      }
    }
  }
  assert.equal(cases, 3600)
  // Day by day, the base stays and the last step gives the original back.
  let state = { capacity: { fred: 5 }, base: {} }
  for (let k = 0; k < 6; k++) state = step(state, 'fred', k, k + 1)
  assert.deepEqual(state.base, { fred: { capacity: 5, workingDays: 10 } })
  for (let k = 6; k > 0; k--) state = step(state, 'fred', k, k - 1)
  assert.deepEqual(state, { capacity: { fred: 5 }, base: {} })
})

test('a capacity that equals the load after the days off come back is not over capacity', () => {
  let state = step({ capacity: { ana: 5 }, base: {} }, 'ana', 0, 5)
  state = step(state, 'ana', 5, 0)
  const members = [{ id: 'ana', name: 'Ana', availability: 1 }]
  const issues = [{ id: 'A-1', title: 't', status: { name: 'todo', category: 'todo' }, assignee: 'ana', estimate: 5 }]
  const report = teamLoad(issues, { members, aging: [], capacity: state.capacity, daysOff: {}, unit: 'points', overloadFactor: 1.5, delivered: null, blocked: new Set() })
  assert.deepEqual(report.rows.find((row) => row.member === 'ana').flags, [])
})

test('recomputeCapacity keeps the base of a member whose capacity was scaled before, and builds on the base and not on the scaled value', () => {
  const state = step({ capacity: { fred: 10 }, base: {} }, 'fred', 0, 3)
  const result = recomputeCapacity(week2, state.capacity, state.base, { fred: off(3) }, { fred: off(5) }, {})
  assert.deepEqual(result.patch, { fred: 5 })
  assert.deepEqual(result.basePatch, {})
})

test('recomputeCapacity ignores a base the capacity no longer matches, so a number typed since wins', () => {
  const base = { fred: { capacity: 10, workingDays: 10 } }
  const result = recomputeCapacity(week2, { fred: 4 }, base, { fred: off(3) }, { fred: off(5) }, {})
  assert.deepEqual(result.patch, { fred: Math.round((4 * 5 * 1e6) / 7) / 1e6 })
  assert.deepEqual(result.basePatch, { fred: { capacity: 4, workingDays: 7 } })
})

test('recomputeCapacity keeps a capacity of 1 and brings it back after most days were off', () => {
  const state = step({ capacity: { fred: 1 }, base: {} }, 'fred', 0, 6)
  assert.deepEqual(state.capacity, { fred: 0.4 })
  assert.deepEqual(step(state, 'fred', 6, 0), { capacity: { fred: 1 }, base: {} })
})

test('recomputeCapacity gives 0 when every working day is off and the base brings the capacity back when the days return', () => {
  const gone = step({ capacity: { ana: 10 }, base: {} }, 'ana', 0, 10)
  assert.deepEqual(gone.capacity, { ana: 0 })
  assert.deepEqual(step(gone, 'ana', 10, 0), { capacity: { ana: 10 }, base: {} })
  assert.deepEqual(step(gone, 'ana', 10, 4).capacity, { ana: 6 })
})

test('recomputeCapacity reports a member with no working days and no base to scale from', () => {
  const stuck = recomputeCapacity(week2, { ana: 5 }, {}, { ana: off(10) }, { ana: [] }, {})
  assert.deepEqual(stuck.patch, {})
  assert.deepEqual(stuck.skipped, ['ana'])
})

test('teamMembers keeps the members of the team and every member when no team is configured or a member has no team list', () => {
  const members = [{ id: 'a', teams: ['ACME'] }, { id: 'b', teams: ['OPS'] }, { id: 'c' }]
  assert.deepEqual(teamMembers(members, 'ACME').map((member) => member.id), ['a', 'c'])
  assert.deepEqual(teamMembers(members, undefined).map((member) => member.id), ['a', 'b', 'c'])
  assert.deepEqual(teamMembers(members, null).map((member) => member.id), ['a', 'b', 'c'])
})
