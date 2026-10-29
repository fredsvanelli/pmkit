import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathNote } from './path-notes.mjs'

test('a native entry has no note', () => {
  assert.equal(pathNote({ id: 'cycles', path: 'native' }, {}), null)
})

test('native_metrics derived from history names the metric and Linear issue history', () => {
  const entry = { id: 'native_metrics', path: 'derived', detail: { source: 'history' } }
  assert.equal(pathNote(entry, { metric: 'cycle time' }), 'cycle time computed from Linear issue history')
})

test('native_metrics derived from events names the Local event file', () => {
  const entry = { id: 'native_metrics', path: 'derived', detail: { source: 'events' } }
  assert.equal(pathNote(entry, { metric: 'throughput' }), 'throughput computed from .issues/events.jsonl')
})

test('velocity names the sprint count and, with estimation absent, the estimate hint', () => {
  const entry = { id: 'native_metrics', path: 'derived', detail: { source: 'history' } }
  assert.equal(pathNote(entry, { metric: 'velocity', sprints: 3 }), 'velocity computed from the last 3 closed sprints')
  const estimation = { id: 'estimation', path: 'absent', enableHint: "Turn on estimates in the team's settings in Linear" }
  assert.equal(
    pathNote(entry, { metric: 'velocity', sprints: 3, estimation }),
    "velocity computed from the last 3 closed sprints; counted issues: estimates are off (Turn on estimates in the team's settings in Linear)",
  )
})

test('capacity derived from the local file says Linear has no capacity field', () => {
  const entry = { id: 'capacity', path: 'derived', detail: { source: 'local' } }
  assert.equal(pathNote(entry, {}), 'capacity read from .pmkit/capacity.yaml; Linear has no capacity field')
})

test('deliverables derived progress says it is computed from the issues', () => {
  const entry = { id: 'deliverables', path: 'derived', detail: { derived: ['deliverableProgress'] } }
  assert.equal(pathNote(entry, {}), "progress computed from the project's issues")
})

test('linked_code derived from git says the tracker is not the source', () => {
  const entry = { id: 'linked_code', path: 'derived', detail: { source: 'git' } }
  assert.equal(pathNote(entry, {}), 'branch and PR state read from git, not from the tracker')
})

test('release notes on another basis name the sprint and the hint', () => {
  const entry = { id: 'releases', path: 'absent', enableHint: 'Linear releases need the Business plan' }
  assert.equal(
    pathNote(entry, { releaseNotesFrom: 'sprint-4' }),
    'release notes built from sprint sprint-4: Linear releases need the Business plan',
  )
})

test('a conditional entry lists the teams, and names the issue team when given', () => {
  const entry = { id: 'cycles', path: 'conditional', detail: { teams: ['ACME', 'OPS'] } }
  assert.equal(pathNote(entry, {}), 'cycles is on for teams ACME, OPS only')
  assert.equal(pathNote(entry, { issue: 'ACME-3', team: 'WEB' }), 'cycles is on for teams ACME, OPS only; ACME-3 is in team WEB')
})

test('an absent entry answered empty gives the hint', () => {
  const entry = { id: 'releases', path: 'absent', enableHint: 'Linear releases need the Business plan' }
  assert.equal(pathNote(entry, {}), 'releases is absent: Linear releases need the Business plan')
})
