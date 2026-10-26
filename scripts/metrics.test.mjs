import { test } from 'node:test'
import assert from 'node:assert/strict'
import { businessDaysBetween, cycleTimes, summary, velocity } from './lib/metrics.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { fixedNow, makeRepo } from './test-helpers.mjs'

const categoryOf = (name) => ({ todo: 'todo', doing: 'in_progress', review: 'in_review', done: 'done' })[name] ?? 'backlog'
const sprint = (id, end, state = 'closed') => ({ id, end, state })
const item = (estimate, doneAt, status = 'done') => ({ id: 'x', estimate, status, doneAt })

test('velocity averages the last window of closed sprints', () => {
  const sprints = [sprint('a', '2026-01-10'), sprint('b', '2026-01-24'), sprint('c', '2026-02-07'), sprint('d', '2026-02-21'), sprint('e', '2026-03-07', 'active')]
  const issuesBySprint = {
    a: [item(100, '2026-01-09T10:00:00Z')],
    b: [item(3, '2026-01-20T10:00:00Z'), item(5, '2026-01-24T23:00:00Z')],
    c: [item(2, '2026-02-06T10:00:00Z'), item(4, '2026-02-08T10:00:00Z'), item(9, undefined, 'todo')],
    d: [item(6, '2026-02-20T10:00:00Z')],
  }
  const result = velocity(sprints, issuesBySprint, { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: 'b', points: 8, count: 2 }, { id: 'c', points: 2, count: 1 }, { id: 'd', points: 6, count: 1 }])
  assert.equal(result.average, 5.3)
  assert.equal(result.unit, 'points')
})

test('velocity falls back to issue counts when no issue has a numeric estimate', () => {
  const sprints = [sprint('a', '2026-01-10'), sprint('b', '2026-01-24')]
  const issuesBySprint = { a: [item(undefined, '2026-01-05T00:00:00Z')], b: [item(undefined, '2026-01-20T00:00:00Z'), item(undefined, '2026-01-21T00:00:00Z'), item(undefined, '2026-01-22T00:00:00Z')] }
  const result = velocity(sprints, issuesBySprint, { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: 'a', points: 0, count: 1 }, { id: 'b', points: 0, count: 3 }])
  assert.equal(result.average, 2)
  assert.equal(result.unit, 'issues')
})

test('velocity with no closed sprint is zero', () => {
  assert.deepEqual(velocity([sprint('a', '2026-01-10', 'active')], {}, { window: 3, categoryOf }), { perSprint: [], average: 0, unit: 'issues' })
})

const closedAt = (id, end, closed) => ({ id, end, state: 'closed', closed })

test('velocity counts a move to done up to the close of a late-closed sprint', () => {
  const sprints = [closedAt('a', '2026-10-25', '2026-10-26T12:00:00Z')]
  const issuesBySprint = {
    a: [item(2, '2026-10-24T15:00:00Z'), item(3, '2026-10-26T10:00:00Z'), item(5, '2026-10-26T12:00:00Z'), item(8, '2026-10-27T10:00:00Z')],
  }
  const result = velocity(sprints, issuesBySprint, { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: 'a', points: 10, count: 3 }])
})

test('velocity compares doneAt and closed as instants, with an offset or a fraction', () => {
  const offset = velocity([closedAt('a', '2026-10-25', '2026-10-26T09:00:00-03:00')], {
    a: [item(3, '2026-10-26T11:30:00Z'), item(5, '2026-10-26T12:00:01Z')],
  }, { window: 3, categoryOf })
  assert.deepEqual(offset.perSprint, [{ id: 'a', points: 3, count: 1 }])
  const fraction = velocity([closedAt('b', '2026-10-25', '2026-10-26T12:00:00.500Z')], {
    b: [item(3, '2026-10-26T12:00:00Z'), item(5, '2026-10-26T12:00:01Z')],
  }, { window: 3, categoryOf })
  assert.deepEqual(fraction.perSprint, [{ id: 'b', points: 3, count: 1 }])
})

test('velocity leaves out a move to done after an early close', () => {
  const result = velocity([closedAt('a', '2026-10-25', '2026-10-23T12:00:00Z')], {
    a: [item(3, '2026-10-24T10:00:00Z')],
  }, { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: 'a', points: 0, count: 0 }])
})

test('velocity applies the close cutoff per sprint and the end date to a sprint without closed', () => {
  const sprints = [sprint('old', '2026-10-11'), closedAt('new', '2026-10-25', '2026-10-26T12:00:00Z')]
  const issuesBySprint = {
    old: [item(6, '2026-10-11T10:00:00Z'), item(4, '2026-10-12T10:00:00Z')],
    new: [item(3, '2026-10-26T10:00:00Z'), item(7, undefined)],
  }
  const result = velocity(sprints, issuesBySprint, { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: 'old', points: 6, count: 1 }, { id: 'new', points: 3, count: 1 }])
  assert.equal(result.average, 4.5)
})

test('cycle time runs from the first start to the last done, even after a move back', () => {
  const move = (at, to) => ({ at, by: 'fred', op: 'move', field: 'status', to })
  const events = {
    'ISS-1': [move('2026-10-01T08:00:00Z', 'doing'), move('2026-10-02T08:00:00Z', 'review'), move('2026-10-03T08:00:00Z', 'doing'), move('2026-10-04T08:00:00Z', 'review'), move('2026-10-05T20:00:00Z', 'done')],
    'ISS-2': [move('2026-10-01T08:00:00Z', 'todo')],
    'ISS-3': [move('2026-10-01T08:00:00Z', 'doing')],
  }
  assert.deepEqual(cycleTimes(events, { categoryOf }), [{ issue: 'ISS-1', days: 4.5 }])
})

test('summary gives the median and the 85th percentile by linear interpolation', () => {
  assert.deepEqual(summary([10, 4, 3, 2, 1]), { count: 5, median: 3, p85: 6.4 })
  assert.deepEqual(summary([4, 2]), { count: 2, median: 3, p85: 3.7 })
  assert.deepEqual(summary([7]), { count: 1, median: 7, p85: 7 })
  assert.deepEqual(summary([]), { count: 0, median: null, p85: null })
})

test('business days count Monday to Friday after the first date', () => {
  assert.equal(businessDaysBetween('2026-10-23', '2026-10-26'), 1)
  assert.equal(businessDaysBetween('2026-10-23', '2026-10-23'), 0)
  assert.equal(businessDaysBetween('2026-10-19', '2026-10-23'), 4)
  assert.equal(businessDaysBetween('2026-10-22T23:00:00Z', '2026-10-28T01:00:00Z'), 4)
  assert.equal(businessDaysBetween('2026-10-24', '2026-10-25'), 0)
})

test('metricEvents returns every issue event in the range, tagged and sorted', () => {
  const tracker = createLocalTracker(makeRepo('team'), { now: fixedNow(), random: () => 0 })
  const all = tracker.metricEvents({})
  assert.ok(all.length > 20)
  assert.ok(all.every((event) => /^ISS-/.test(event.issue) && event.at))
  assert.deepEqual(all.map((event) => event.at), all.map((event) => event.at).sort())
  const ranged = tracker.metricEvents({ since: '2026-10-05', until: '2026-10-08' })
  assert.ok(ranged.length > 0 && ranged.length < all.length)
  assert.ok(ranged.every((event) => event.at >= '2026-10-05' && event.at <= '2026-10-08T23:59:59Z'))
  assert.ok(ranged.some((event) => event.at.startsWith('2026-10-08T')))
  assert.equal(tracker.metricEvents({ since: '2027-01-01' }).length, 0)
})

test('issuesBySprint and velocity on the team fixture give 10 points for the closed sprint', () => {
  const tracker = createLocalTracker(makeRepo('team'), { now: fixedNow(), random: () => 0 })
  const categoryOf = tracker.categoryOf
  const result = velocity(tracker.listCycles(), tracker.issuesBySprint(), { window: 3, categoryOf })
  assert.deepEqual(result.perSprint, [{ id: '2026-09-28', points: 10, count: 3 }])
  assert.equal(result.average, 10)
  const times = cycleTimes(tracker.eventsByIssue(), { categoryOf })
  assert.ok(times.some((entry) => entry.issue === 'ISS-7K3Q' && entry.days === 7.3))
})
