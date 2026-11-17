// The pure mapping of GitHub milestones to pmkit milestones.
import assert from 'node:assert/strict'
import test from 'node:test'
import { MILESTONES_QUERY, toMilestone } from './projects.mjs'

test('toMilestone uses the title as id and name, the date part of dueOn and the lower-case status', () => {
  assert.deepEqual(
    toMilestone({ id: 'MI_1', number: 1, title: 'v1.0', description: 'First release', dueOn: '2026-12-31T00:00:00Z', state: 'OPEN' }),
    { id: 'v1.0', name: 'v1.0', due: '2026-12-31', description: 'First release', status: 'open' },
  )
})

test('toMilestone omits a null due date and an empty description, and maps CLOSED', () => {
  assert.deepEqual(toMilestone({ id: 'MI_2', number: 2, title: 'Old', description: '', dueOn: null, state: 'CLOSED' }), { id: 'Old', name: 'Old', status: 'closed' })
  assert.deepEqual(toMilestone({ id: 'MI_3', number: 3, title: 'New', description: null, dueOn: null, state: 'OPEN' }), { id: 'New', name: 'New', status: 'open' })
})

test('toMilestone reads a REST answer, with due_on and a lower-case state', () => {
  assert.deepEqual(toMilestone({ number: 4, title: 'v2', node_id: 'MI_4', due_on: '2026-12-31T00:00:00Z', state: 'open', description: null }), { id: 'v2', name: 'v2', due: '2026-12-31', status: 'open' })
})

test('MILESTONES_QUERY starts with its operation and reads open and closed milestones', () => {
  assert.match(MILESTONES_QUERY, /^query PmkitMilestones\(/)
  assert.match(MILESTONES_QUERY, /states: \[OPEN, CLOSED\]/)
})
