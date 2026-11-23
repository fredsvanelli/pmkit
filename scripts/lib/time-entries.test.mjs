// Tests of the time-entry summing shared by the Local and Jira trackers (PMK-80).
import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeTimeEntries } from './time-entries.mjs'

const SPRINTS = [
  { id: '2', start: '2026-11-15', end: '2026-11-28' },
  { id: '1', start: '2026-11-01', end: '2026-11-14' },
]

test('sums the entries per person and per sprint, by the UTC date of each entry', () => {
  const result = summarizeTimeEntries({
    issue: 'ENG-1',
    entries: [
      { at: '2026-11-03T10:00:00Z', by: 'a', minutes: 45 },
      { at: '2026-11-20T23:30:00-03:00', by: 'b', minutes: 90 },
    ],
    sprints: SPRINTS,
    ignored: 1,
  })
  assert.deepEqual(result, {
    issue: 'ENG-1',
    entries: [
      { at: '2026-11-03T10:00:00Z', by: 'a', minutes: 45, time: '45m' },
      { at: '2026-11-20T23:30:00-03:00', by: 'b', minutes: 90, time: '1h30' },
    ],
    total: 135,
    totalTime: '2h15',
    byPerson: [{ by: 'a', minutes: 45, time: '45m' }, { by: 'b', minutes: 90, time: '1h30' }],
    bySprint: [{ sprint: '1', minutes: 45, time: '45m' }, { sprint: '2', minutes: 90, time: '1h30' }],
    ignored: 1,
  })
})

test('an entry outside every dated sprint counts as no sprint', () => {
  const result = summarizeTimeEntries({
    issue: 'ENG-1',
    entries: [{ at: '2026-12-20T10:00:00Z', by: 'a', minutes: 30 }],
    sprints: [...SPRINTS, { id: '3', start: null, end: null }],
    ignored: 0,
  })
  assert.deepEqual(result.bySprint, [{ sprint: null, minutes: 30, time: '30m' }])
})

test('no entries give zero totals and empty groups', () => {
  const result = summarizeTimeEntries({ issue: 'ENG-1', entries: [], sprints: SPRINTS, ignored: 2 })
  assert.deepEqual(result, { issue: 'ENG-1', entries: [], total: 0, totalTime: '0m', byPerson: [], bySprint: [], ignored: 2 })
})
