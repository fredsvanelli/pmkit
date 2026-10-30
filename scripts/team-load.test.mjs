import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OVER_AVERAGE, chooseUnit, suggestMoves, teamLoad } from './lib/team-load.mjs'

const issue = (id, category, assignee, estimate, extra = {}) => ({ id, title: `Title ${id}`, status: { name: category, category }, assignee, estimate, ...extra })
const MEMBERS = [
  { id: 'fred', name: 'Fred', availability: 1 },
  { id: 'ana', name: 'Ana', availability: 1 },
  { id: 'agent:claude', name: 'Claude' },
]
const rowOf = (report, id) => report.rows.find((row) => row.member === id)

test('the threshold is 1.5 times the average', () => assert.equal(OVER_AVERAGE, 1.5))

test('chooseUnit counts issues when estimation is absent, with the reason', () => {
  assert.deepEqual(chooseUnit([issue('A-1', 'todo', 'fred', 3)], 'absent'), { unit: 'issues', reason: 'estimates are off' })
})

test('chooseUnit counts issues when no issue in scope has an estimate', () => {
  assert.deepEqual(chooseUnit([issue('A-1', 'todo', 'fred')], 'native'), { unit: 'issues', reason: 'no issue in scope has an estimate' })
  assert.deepEqual(chooseUnit([], 'native'), { unit: 'issues', reason: 'no issue in scope has an estimate' })
})

test('chooseUnit uses points when at least one issue has an estimate', () => {
  assert.deepEqual(chooseUnit([issue('A-1', 'todo', 'fred'), issue('A-2', 'todo', 'ana', 2)], 'native'), { unit: 'points', reason: null })
})

test('teamLoad counts issues, points, unestimated, wip and the oldest wip per member', () => {
  const issues = [
    issue('A-1', 'todo', 'fred', 3), issue('A-2', 'in_progress', 'fred', 5), issue('A-3', 'in_review', 'fred'), issue('A-4', 'todo', 'ana', 2),
  ]
  const aging = [{ issue: 'A-2', days: 4.5 }, { issue: 'A-3', days: 1 }, { issue: 'A-9', days: 40 }]
  const report = teamLoad(issues, { members: MEMBERS, aging, unit: 'points' })
  assert.deepEqual(report.rows.map((row) => row.member), ['fred', 'ana', 'agent:claude'])
  const fred = rowOf(report, 'fred')
  assert.deepEqual([fred.issues, fred.points, fred.unestimated, fred.wip, fred.oldestWipDays, fred.load], [3, 8, 1, 2, 4.5, 8])
  assert.deepEqual(rowOf(report, 'ana').oldestWipDays, null)
})

test('teamLoad counts issues as the load when the unit is issues', () => {
  const report = teamLoad([issue('A-1', 'todo', 'fred', 3), issue('A-2', 'todo', 'fred', 5)], { members: MEMBERS, unit: 'issues' })
  assert.equal(rowOf(report, 'fred').load, 2)
})

test('teamLoad keeps agents and non-members out of the average, noWork and the flags', () => {
  const issues = [
    issue('A-1', 'todo', 'agent:claude', 1), issue('A-2', 'todo', 'agent:claude', 1), issue('A-3', 'todo', 'agent:claude', 1),
    issue('A-4', 'todo', 'gone', 1), issue('A-5', 'todo', undefined, 2), issue('A-6', 'todo', 'fred', 1), issue('A-7', 'todo', 'ana', 1),
  ]
  const report = teamLoad(issues, { members: MEMBERS, unit: 'points' })
  assert.deepEqual(report.rows.map((row) => [row.member, row.agent, row.isMember]), [['fred', false, true], ['ana', false, true], ['agent:claude', true, true], ['gone', false, false]])
  assert.equal(report.average, 1)
  assert.deepEqual(report.imbalances, [])
  assert.deepEqual(report.noWork, [])
  assert.deepEqual([report.unassigned.issues, report.unassigned.points, report.unassigned.ids], [1, 2, ['A-5']])
})

test('teamLoad lists the humans with no work and skips availability 0', () => {
  const members = [...MEMBERS, { id: 'bia', name: 'Bia', availability: 0 }, { id: 'caio', name: 'Caio', availability: 1 }]
  const report = teamLoad([issue('A-1', 'todo', 'fred', 3)], { members, daysOff: { caio: ['2026-10-16'] }, unit: 'points' })
  assert.deepEqual(report.noWork, [{ member: 'ana', name: 'Ana', daysOff: [] }, { member: 'caio', name: 'Caio', daysOff: ['2026-10-16'] }])
})

test('teamLoad flags over_average above 1.5 times the average of the humans', () => {
  const issues = [issue('A-1', 'todo', 'fred', 8), issue('A-2', 'todo', 'ana', 2)]
  const report = teamLoad(issues, { members: MEMBERS, unit: 'points' })
  assert.equal(report.average, 5)
  assert.deepEqual(report.imbalances, [{ member: 'fred', flag: 'over_average', load: 8, limit: 7.5 }])
  assert.deepEqual(rowOf(report, 'fred').flags, ['over_average'])
})

test('teamLoad flags no over_average with one human, and none at exactly 1.5 times', () => {
  const one = teamLoad([issue('A-1', 'todo', 'fred', 8)], { members: [MEMBERS[0]], unit: 'points' })
  assert.deepEqual(one.imbalances, [])
  const edge = teamLoad([issue('A-1', 'todo', 'fred', 3), issue('A-2', 'todo', 'ana', 1)], { members: MEMBERS, unit: 'points' })
  assert.equal(edge.average, 2)
  assert.deepEqual(edge.imbalances, [])
})

test('teamLoad flags over_capacity on points above the sprint capacity', () => {
  const issues = [issue('A-1', 'todo', 'fred', 5), issue('A-2', 'todo', 'ana', 5)]
  const report = teamLoad(issues, { members: MEMBERS, capacity: { fred: 4, ana: 10 }, unit: 'points' })
  assert.deepEqual(report.imbalances, [{ member: 'fred', flag: 'over_capacity', load: 5, limit: 4 }])
  const counted = teamLoad(issues, { members: MEMBERS, capacity: { fred: 4 }, unit: 'issues' })
  assert.deepEqual(counted.imbalances, [])
})

test('suggestMoves moves todo issues, largest first, from an over member to the lowest load human', () => {
  const issues = [
    issue('A-1', 'todo', 'fred', 3), issue('A-2', 'todo', 'fred', 5), issue('A-3', 'in_progress', 'fred', 8), issue('A-4', 'todo', 'ana', 1),
  ]
  const members = [...MEMBERS, { id: 'caio', name: 'Caio', availability: 1 }]
  const report = teamLoad(issues, { members, unit: 'points' })
  assert.deepEqual(report.imbalances.map((item) => item.member), ['fred'])
  assert.deepEqual(suggestMoves(report, issues), [{ issue: 'A-2', from: 'fred', to: 'caio' }, { issue: 'A-1', from: 'fred', to: 'ana' }])
})

test('suggestMoves never leaves the target above the source and skips agents as targets', () => {
  const issues = [issue('A-1', 'todo', 'fred', 8), issue('A-2', 'todo', 'ana', 7)]
  const report = teamLoad(issues, { members: MEMBERS, capacity: { fred: 4 }, unit: 'points' })
  assert.deepEqual(suggestMoves(report, issues), [])
})

test('suggestMoves suggests nothing without a flag', () => {
  const issues = [issue('A-1', 'todo', 'fred', 3), issue('A-2', 'todo', 'ana', 3)]
  assert.deepEqual(suggestMoves(teamLoad(issues, { members: MEMBERS, unit: 'points' }), issues), [])
})
