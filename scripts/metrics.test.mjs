import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aging, businessDaysBetween, cycleTimes, doneInRange, leadTimes, rangeInstant, throughput, summary, velocity } from './lib/metrics.mjs'
import { createLocalTracker } from './lib/local/tracker.mjs'
import { fixedNow, makeRepo } from './test-helpers.mjs'

const categoryOf = (name) => ({ todo: 'todo', doing: 'in_progress', review: 'in_review', done: 'done', canceled: 'canceled' })[name] ?? 'backlog'
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

const create = (at, status, type) => ({ at, by: 'fred', op: 'create', to: { status, type } })
const move = (at, to) => ({ at, by: 'fred', op: 'move', field: 'status', to })

test('rangeInstant reads a date as the start or the end of the day, and a time without a zone as UTC', () => {
  assert.equal(rangeInstant('2026-10-06'), Date.parse('2026-10-06T00:00:00Z'))
  assert.equal(rangeInstant('2026-10-06', { endOfDay: true }), Date.parse('2026-10-06T23:59:59Z'))
  assert.equal(rangeInstant('2026-10-06T16:00:00'), Date.parse('2026-10-06T16:00:00Z'))
  assert.equal(rangeInstant('2026-10-06T16:00', { endOfDay: true }), Date.parse('2026-10-06T16:00Z'))
  assert.ok(Number.isNaN(rangeInstant('2026-10-08T1')))
  assert.ok(Number.isNaN(rangeInstant('2026-13-40')))
})

test('doneInRange keeps the issues whose last move into done falls in the range', () => {
  const events = {
    'ISS-1': [move('2026-10-05T23:30:00Z', 'done')],
    'ISS-2': [move('2026-10-06T00:00:00Z', 'done')],
    'ISS-3': [move('2026-10-08T23:59:59Z', 'done')],
    'ISS-4': [move('2026-10-09T00:00:00Z', 'done')],
    'ISS-5': [move('2026-10-05T00:00:00Z', 'todo')],
  }
  const keys = (range) => Object.keys(doneInRange(events, { categoryOf, ...range }))
  assert.deepEqual(keys({ since: '2026-10-06', until: '2026-10-08' }), ['ISS-2', 'ISS-3'])
  assert.deepEqual(keys({}), ['ISS-1', 'ISS-2', 'ISS-3', 'ISS-4'])
  assert.deepEqual(keys({ since: '2026-10-09' }), ['ISS-4'])
  assert.deepEqual(keys({ until: '2026-10-05' }), ['ISS-1'])
  assert.equal(doneInRange(events, { categoryOf, since: '2026-10-06' })['ISS-2'], events['ISS-2'])
})

test('doneInRange compares an offset timestamp as an instant', () => {
  const events = { 'ISS-7': [move('2026-10-08T22:00:00-03:00', 'done')] }
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, until: '2026-10-08' })), [])
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, since: '2026-10-09' })), ['ISS-7'])
})

test('doneInRange uses the last move into done after a reopen', () => {
  const events = { 'ISS-8': [move('2026-10-02T10:00:00Z', 'done'), move('2026-10-03T10:00:00Z', 'doing'), move('2026-10-10T10:00:00Z', 'done')] }
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, since: '2026-10-10' })), ['ISS-8'])
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, until: '2026-10-05' })), [])
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

test('lead time runs from the create to the last done', () => {
  const events = {
    'ISS-1': [create('2026-10-01T08:00:00Z', 'todo'), move('2026-10-02T08:00:00Z', 'doing'), move('2026-10-03T08:00:00Z', 'done'), move('2026-10-04T08:00:00Z', 'doing'), move('2026-10-05T20:00:00Z', 'done')],
    'ISS-2': [create('2026-10-01T08:00:00Z', 'todo')],
  }
  assert.deepEqual(leadTimes(events, { categoryOf }), [{ issue: 'ISS-1', days: 4.5 }])
})

test('lead time starts at the earliest event when the log has no create', () => {
  const events = { 'ISS-1': [move('2026-10-03T08:00:00Z', 'doing'), move('2026-10-01T08:00:00Z', 'todo'), move('2026-10-06T08:00:00Z', 'done')] }
  assert.deepEqual(leadTimes(events, { categoryOf }), [{ issue: 'ISS-1', days: 5 }])
})

test('lead time starts at the first create when a merge left two', () => {
  const events = { 'ISS-4': [create('2026-10-14T09:00:00Z', 'todo', 'bug'), create('2026-10-14T11:30:00Z', 'todo', 'bug'), move('2026-10-15T09:00:00Z', 'done')] }
  assert.deepEqual(leadTimes(events, { categoryOf }), [{ issue: 'ISS-4', days: 1 }])
})

test('leadTimes on the team fixture gives the spec numbers', () => {
  const tracker = createLocalTracker(makeRepo('team'), { now: fixedNow(), random: () => 0 })
  const times = leadTimes(tracker.eventsByIssue(), { categoryOf: tracker.categoryOf })
  assert.deepEqual(times, [{ issue: 'ISS-4P8A', days: 12.3 }, { issue: 'ISS-7K3Q', days: 10.3 }, { issue: 'ISS-9T2M', days: 8.3 }])
  assert.deepEqual(summary(times.map((t) => t.days)), { count: 3, median: 10.3, p85: 11.7 })
})

test('throughput counts done issues by type and leaves canceled out', () => {
  const events = {
    'ISS-1': [create('2026-10-01T08:00:00Z', 'todo', 'bug'), move('2026-10-05T15:00:00Z', 'done')],
    'ISS-2': [create('2026-10-01T08:00:00Z', 'todo', 'feature'), move('2026-10-03T10:00:00Z', 'done')],
    'ISS-3': [create('2026-10-01T08:00:00Z', 'todo', 'bug'), move('2026-10-04T10:00:00Z', 'canceled')],
    'ISS-4': [create('2026-10-01T08:00:00Z', 'todo', 'bug'), move('2026-10-03T10:00:00Z', 'done')],
  }
  assert.deepEqual(throughput(events, { categoryOf }), {
    count: 3,
    byType: { bug: 2, feature: 1 },
    issues: [
      { issue: 'ISS-2', type: 'feature', doneAt: '2026-10-03T10:00:00Z' },
      { issue: 'ISS-4', type: 'bug', doneAt: '2026-10-03T10:00:00Z' },
      { issue: 'ISS-1', type: 'bug', doneAt: '2026-10-05T15:00:00Z' },
    ],
  })
})

test('throughput takes the last type and counts no type under none', () => {
  const done = move('2026-10-09T08:00:00Z', 'done')
  const events = {
    'ISS-1': [create('2026-10-01T08:00:00Z', 'todo', 'feature'), { at: '2026-10-02T08:00:00Z', by: 'fred', op: 'update', field: 'type', from: 'feature', to: 'bug' }, done],
    'ISS-2': [{ at: '2026-10-01T08:00:00Z', by: 'fred', op: 'create', to: { status: 'todo' } }, done],
    'ISS-3': [create('2026-10-01T08:00:00Z', 'todo', 'chore'), { at: '2026-10-02T08:00:00Z', by: 'fred', op: 'update', field: 'type', from: 'chore', to: null }, done],
    'ISS-4': [create('2026-10-01T08:00:00Z', 'todo', 'bug'), create('2026-10-01T09:00:00Z', 'todo', 'adr'), done],
  }
  const result = throughput(events, { categoryOf })
  const types = Object.fromEntries(result.issues.map((item) => [item.issue, item.type]))
  assert.deepEqual(types, { 'ISS-1': 'bug', 'ISS-2': null, 'ISS-3': null, 'ISS-4': 'adr' })
  assert.deepEqual(Object.keys(result.byType), ['adr', 'bug', 'none'])
  assert.deepEqual(result.byType, { adr: 1, bug: 1, none: 2 })
})

test('throughput on the team fixture gives the spec numbers', () => {
  const tracker = createLocalTracker(makeRepo('team'), { now: fixedNow(), random: () => 0 })
  const events = tracker.eventsByIssue()
  assert.deepEqual(throughput(events, { categoryOf: tracker.categoryOf }), {
    count: 3,
    byType: { bug: 2, feature: 1 },
    issues: [
      { issue: 'ISS-9T2M', type: 'bug', doneAt: '2026-10-05T15:00:00Z' },
      { issue: 'ISS-7K3Q', type: 'bug', doneAt: '2026-10-06T16:00:00Z' },
      { issue: 'ISS-4P8A', type: 'feature', doneAt: '2026-10-08T17:00:00Z' },
    ],
  })
  const ranged = doneInRange(events, { categoryOf: tracker.categoryOf, since: '2026-10-06', until: '2026-10-08' })
  assert.deepEqual(Object.keys(ranged), ['ISS-4P8A', 'ISS-7K3Q'])
})

const AS_OF = '2026-10-10T12:00:00Z'

test('aging lists the issues in work at asOf, oldest first', () => {
  const events = {
    'ISS-1': [create('2026-10-01T08:00:00Z', 'todo'), move('2026-10-02T12:00:00Z', 'doing')],
    'ISS-2': [create('2026-10-05T12:00:00Z', 'review')],
    'ISS-3': [create('2026-10-01T08:00:00Z', 'todo')],
    'ISS-4': [move('2026-10-01T12:00:00Z', 'doing'), move('2026-10-03T12:00:00Z', 'done')],
    'ISS-5': [move('2026-10-06T12:00:00Z', 'doing')],
    'ISS-6': [move('2026-10-06T12:00:00Z', 'doing')],
  }
  assert.deepEqual(aging(events, { categoryOf, asOf: AS_OF }), [
    { issue: 'ISS-1', status: 'doing', startedAt: '2026-10-02T12:00:00Z', days: 8 },
    { issue: 'ISS-2', status: 'review', startedAt: '2026-10-05T12:00:00Z', days: 5 },
    { issue: 'ISS-5', status: 'doing', startedAt: '2026-10-06T12:00:00Z', days: 4 },
    { issue: 'ISS-6', status: 'doing', startedAt: '2026-10-06T12:00:00Z', days: 4 },
  ])
})

test('aging starts at the first move into work and leaves out an issue moved back to todo', () => {
  const events = {
    'ISS-1': [move('2026-10-01T12:00:00Z', 'doing'), move('2026-10-03T12:00:00Z', 'review'), move('2026-10-04T12:00:00Z', 'doing')],
    'ISS-2': [move('2026-10-02T12:00:00Z', 'doing'), move('2026-10-04T12:00:00Z', 'todo')],
  }
  assert.deepEqual(aging(events, { categoryOf, asOf: AS_OF }), [{ issue: 'ISS-1', status: 'doing', startedAt: '2026-10-01T12:00:00Z', days: 9 }])
})

test('aging replays only the events on or before asOf', () => {
  const events = {
    'ISS-1': [move('2026-10-01T12:00:00Z', 'doing'), move('2026-10-11T12:00:00Z', 'done')],
    'ISS-2': [move('2026-10-10T12:00:00Z', 'doing')],
    'ISS-3': [move('2026-10-10T12:00:01Z', 'doing')],
  }
  assert.deepEqual(aging(events, { categoryOf, asOf: AS_OF }).map((i) => [i.issue, i.days]), [['ISS-1', 9], ['ISS-2', 0]])
})

test('aging leaves out an archived issue from its archive event', () => {
  const events = {
    'ISS-1': [move('2026-10-01T12:00:00Z', 'doing'), { at: '2026-10-05T10:00:00Z', by: 'fred', op: 'archive' }],
    'ISS-2': [move('2026-10-01T12:00:00Z', 'doing'), { at: '2026-10-11T10:00:00Z', by: 'fred', op: 'archive' }],
  }
  assert.deepEqual(aging(events, { categoryOf, asOf: AS_OF }).map((i) => [i.issue, i.days]), [['ISS-2', 9]])
})

test('aging on the team fixture gives the spec numbers', () => {
  const tracker = createLocalTracker(makeRepo('team'), { now: fixedNow(), random: () => 0 })
  const result = aging(tracker.eventsByIssue(), { categoryOf: tracker.categoryOf, asOf: '2026-10-23T12:00:00Z' })
  assert.deepEqual(result, [
    { issue: 'ISS-2X6D', status: 'in_progress', startedAt: '2026-10-14T09:00:00Z', days: 9.1 },
    { issue: 'ISS-8C4W', status: 'in_review', startedAt: '2026-10-15T09:00:00Z', days: 8.1 },
    { issue: 'ISS-5N1R', status: 'in_progress', startedAt: '2026-10-22T09:00:00Z', days: 1.1 },
  ])
  assert.deepEqual(summary(result.map((i) => i.days)), { count: 3, median: 8.1, p85: 8.8 })
})

function underTimeZone(zone, body) {
  const before = process.env.TZ
  process.env.TZ = zone
  try {
    body()
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
}

test('an event time without a zone is UTC whatever the machine time zone', () => {
  underTimeZone('America/Sao_Paulo', () => {
    const events = { 'ISS-1': [create('2026-10-01T08:00:00', 'todo'), move('2026-10-01T09:00:00', 'doing'), move('2026-10-08T22:00:00', 'done')] }
    assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, until: '2026-10-08' })), ['ISS-1'])
    assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, since: '2026-10-09' })), [])
    assert.deepEqual(leadTimes(events, { categoryOf }), [{ issue: 'ISS-1', days: 7.6 }])
    assert.deepEqual(cycleTimes(events, { categoryOf }), [{ issue: 'ISS-1', days: 7.5 }])
    const two = { 'ISS-2': [move('2026-10-08T23:00:00', 'done')], 'ISS-3': [move('2026-10-08T22:00:00', 'done')] }
    assert.deepEqual(throughput(two, { categoryOf }).issues.map((i) => i.issue), ['ISS-3', 'ISS-2'])
    const open = { 'ISS-4': [move('2026-10-10T10:00:00', 'doing')] }
    assert.equal(aging(open, { categoryOf, asOf: '2026-10-10T12:00:00Z' }).length, 1)
  })
})

test('doneInRange, leadTimes and aging skip an event time that is not a date', () => {
  const events = { 'ISS-1': [create('2026-10-01T08:00:00Z', 'todo'), move('yesterday', 'done')] }
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf })), [])
  assert.deepEqual(Object.keys(doneInRange(events, { categoryOf, until: '2026-10-08' })), [])
  assert.deepEqual(leadTimes(events, { categoryOf }), [])
  assert.deepEqual(cycleTimes({ 'ISS-1': [move('2026-10-01T08:00:00Z', 'doing'), move('yesterday', 'done')] }, { categoryOf }), [])
  assert.deepEqual(aging({ 'ISS-2': [move('yesterday', 'doing')] }, { categoryOf, asOf: AS_OF }), [])
  const later = { 'ISS-3': [move('2026-10-01T08:00:00Z', 'doing'), move('yesterday', 'done')] }
  assert.deepEqual(aging(later, { categoryOf, asOf: AS_OF }).map((i) => i.issue), ['ISS-3'])
})
