// PMK-66: the pure roadmap review builder and its text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRoadmapReview, roadmapReviewText } from './lib/roadmap-review.mjs'

const TODAY = '2026-11-07'
const status = (category, name = category) => ({ name, category })
const epic = (id, fields = {}) => ({ id, title: `Epic ${id}`, status: status('in_progress'), ...fields })
const issue = (id, fields = {}) => ({ id, title: `Issue ${id}`, status: status('todo'), ...fields })
const progress = { total: 2, done: 1, canceled: 0 }

function review(input = {}) {
  const epics = input.epics === undefined ? [] : input.epics
  const ids = (epics ?? []).map((row) => row.id)
  return buildRoadmapReview({
    today: TODAY,
    windowDays: 14,
    issues: [],
    issuesComplete: true,
    milestones: [],
    progressByEpic: Object.fromEntries(ids.map((id) => [id, progress])),
    updatesByEpic: Object.fromEntries(ids.map((id) => [id, [{ at: '2026-11-06T10:00:00Z', health: 'on_track' }]])),
    ...input,
    epics,
  })
}
const row = (report, id) => report.epics.find((entry) => entry.id === id)

test('an open epic past its target is late by whole UTC days; due today is not late; no target is unknown', () => {
  const report = review({ epics: [epic('E1', { target: '2026-11-06' }), epic('E2', { target: TODAY }), epic('E3')] })
  assert.equal(row(report, 'E1').delayDays, 1)
  assert.ok(row(report, 'E1').reasons.includes('late'))
  assert.equal(row(report, 'E2').delayDays, 0)
  assert.ok(!row(report, 'E2').reasons.includes('late'))
  assert.equal(row(report, 'E3').delayDays, null)
  assert.equal(row(report, 'E3').target, null)
})

test('a terminal epic has no delay and no reasons', () => {
  const report = review({ epics: [epic('E1', { status: status('done'), target: '2026-10-01' })], updatesByEpic: { E1: [] } })
  assert.equal(row(report, 'E1').delayDays, 0)
  assert.deepEqual(row(report, 'E1').reasons, [])
  assert.deepEqual(report.noRecentUpdates, [])
})

test('an update 14 days old is recent, 15 days old is not, none is not, and an unread list is not checked', () => {
  const report = review({
    epics: [epic('E14'), epic('E15'), epic('E0'), epic('EX')],
    updatesByEpic: {
      E14: [{ at: '2026-10-24T23:00:00Z', health: 'on_track' }],
      E15: [{ at: '2026-10-23T00:00:00Z', health: 'on_track' }],
      E0: [],
      EX: null,
    },
  })
  assert.deepEqual(report.noRecentUpdates, ['E15', 'E0'])
  assert.deepEqual(report.updatesNotChecked, ['EX'])
  assert.ok(!row(report, 'EX').reasons.includes('no_recent_update'))
  assert.equal(row(report, 'EX').lastUpdate, null)
  assert.equal(report.incomplete, true)
})

test('health is the newest update, else the epic health, else unknown, never from progress', () => {
  const report = review({
    epics: [epic('E1'), epic('E2', { health: 'on_track' }), epic('E3')],
    updatesByEpic: { E1: [{ at: '2026-11-06T00:00:00Z', health: 'at_risk' }, { at: '2026-11-01T00:00:00Z', health: 'on_track' }], E2: [], E3: [] },
    progressByEpic: { E1: progress, E2: progress, E3: { total: 4, done: 4, canceled: 0 } },
  })
  assert.equal(row(report, 'E1').health, 'at_risk')
  assert.deepEqual(row(report, 'E1').lastUpdate, { at: '2026-11-06T00:00:00Z', health: 'at_risk' })
  assert.ok(row(report, 'E1').reasons.includes('at_risk'))
  assert.equal(row(report, 'E2').health, 'on_track')
  assert.equal(row(report, 'E3').health, null)
  assert.deepEqual(row(report, 'E3').progress, { done: 4, total: 4, canceled: 0 })
})

test('a milestone with only done, canceled and archived issues is not late, an open epic makes it late', () => {
  const milestones = [{ id: 'm1', name: 'M1', due: '2026-11-01' }]
  const issues = [
    issue('I1', { milestone: 'm1', status: status('done') }),
    issue('I2', { milestone: 'm1', status: status('canceled') }),
    issue('I3', { milestone: 'm1', archived: true }),
  ]
  const quiet = review({ milestones, issues })
  assert.deepEqual(quiet.milestones[0], { id: 'm1', name: 'M1', due: '2026-11-01', filed: true, issues: { open: 0, done: 1, canceled: 1 }, epics: [], delayDays: 0 })
  const late = review({ milestones, issues, epics: [epic('E1', { milestone: 'm1' })] })
  assert.equal(late.milestones[0].delayDays, 6)
  assert.deepEqual(late.milestones[0].epics, ['E1'])
  assert.equal(row(late, 'E1').milestone, 'm1')
  const done = review({ milestones, issues, epics: [epic('E1', { milestone: 'm1', status: status('done') })] })
  assert.equal(done.milestones[0].delayDays, 0)
})

test('an open issue past the milestone due date makes it late; a future due date never does', () => {
  const report = review({
    milestones: [{ id: 'm1', name: 'M1', due: '2026-11-06' }, { id: 'm2', name: 'M2', due: '2026-12-01' }],
    issues: [issue('I1', { milestone: 'm1' }), issue('I2', { milestone: 'm2' })],
  })
  assert.deepEqual(report.milestones.map((m) => [m.id, m.delayDays, m.issues.open]), [['m1', 1, 1], ['m2', 0, 1]])
})

test('a Linear milestone names its project, and only its own issues make it late', () => {
  // P-1 is still running: its finished phase Alpha is not late, Beta with an open issue past its due date is.
  const report = review({
    today: '2026-11-07',
    epics: [epic('P-1')],
    milestones: [
      { id: 'uuid-a', name: 'Alpha', due: '2026-10-01', epic: 'P-1' },
      { id: 'uuid-b', name: 'Beta', due: '2026-11-01', epic: 'P-1' },
      { id: 'uuid-c', name: 'Gamma', due: '2026-11-01', epic: 'P-1' },
    ],
    issues: [issue('I1', { milestone: 'uuid-a', status: status('done') }), issue('I2', { milestone: 'uuid-b' })],
  })
  assert.deepEqual(report.milestones.map((m) => [m.name, m.epics, m.delayDays]), [['Alpha', ['P-1'], 0], ['Beta', ['P-1'], 6], ['Gamma', ['P-1'], 0]])
})

test('a cut progress read is partial and makes the review incomplete', () => {
  const report = review({ epics: [epic('E1')], progressByEpic: { E1: { total: 1000, done: 400, canceled: 0, hasMore: true } } })
  assert.deepEqual(row(report, 'E1').progress, { done: 400, total: 1000, canceled: 0, partial: true })
  assert.equal(report.incomplete, true)
  assert.match(roadmapReviewText(report), /400\/1000\+/)
  assert.equal(review({ epics: [epic('E1')] }).incomplete, false)
})

test('an update without health is unknown health and falls back to the epic', () => {
  const report = review({
    epics: [epic('E1'), epic('E2', { health: 'off_track' })],
    updatesByEpic: { E1: [{ at: '2026-11-06T00:00:00Z', health: '' }], E2: [{ at: '2026-11-06T00:00:00Z', health: '' }] },
  })
  assert.equal(row(report, 'E1').health, null)
  assert.deepEqual(row(report, 'E1').lastUpdate, { at: '2026-11-06T00:00:00Z', health: null })
  assert.equal(row(report, 'E2').health, 'off_track')
  assert.match(roadmapReviewText(report), /\| unknown /)
})

test('an epic never started is not listed as not checked', () => {
  const report = review({
    epics: [epic('B0', { status: status('backlog') }), epic('B1', { status: status('backlog'), start: '2026-10-01' }), epic('B2', { status: status('todo'), start: '2026-12-01' }), epic('W1')],
    updatesByEpic: { B0: null, B1: null, B2: null, W1: null },
  })
  assert.deepEqual(report.updatesNotChecked, ['B1', 'W1'])
})

test('a milestone whose file does not parse is filed with an unknown due date', () => {
  const report = review({
    milestones: [{ id: 'm1', name: 'm1', unreadable: true }],
    issues: [issue('I1', { milestone: 'm1' })],
  })
  assert.deepEqual(report.milestones.map((m) => [m.id, m.filed, m.unreadable, m.due, m.delayDays]), [['m1', true, true, null, null]])
  assert.match(roadmapReviewText(report), /unknown, file does not parse/)
})

test('a milestone referenced without a record is unfiled, with an unknown due date, after the filed ones', () => {
  const report = review({
    milestones: [{ id: 'm1', name: 'M1' }],
    epics: [epic('E1', { milestone: 'm8' })],
    issues: [issue('I2', { milestone: 'm9' }), issue('I1', { milestone: 'm9' }), issue('I3', { milestone: 'm8' })],
  })
  assert.deepEqual(report.milestones.map((m) => [m.id, m.filed, m.due, m.delayDays]), [['m1', true, null, null], ['m8', false, null, null], ['m9', false, null, null]])
  assert.deepEqual(report.milestones[2].issues, { open: 2, done: 0, canceled: 0 })
})

test('an incomplete issue read leaves milestone counts unknown and a past due date undecided', () => {
  const report = review({
    issuesComplete: false,
    milestones: [{ id: 'm1', name: 'M1', due: '2026-11-01' }, { id: 'm2', name: 'M2', due: '2026-12-01' }],
    issues: [issue('I1', { milestone: 'm1', status: status('done') })],
  })
  assert.deepEqual(report.milestones.map((m) => [m.id, m.issues, m.delayDays]), [['m1', null, null], ['m2', null, 0]])
  assert.equal(report.incomplete, true)
})

test('an unread progress is unknown and makes the report incomplete', () => {
  const report = review({ epics: [epic('E1')], progressByEpic: { E1: null } })
  assert.equal(row(report, 'E1').progress, null)
  assert.equal(report.incomplete, true)
})

test('without epics the review falls back to late open issues; with epics it lists none', () => {
  const issues = [
    issue('I1', { due: '2026-11-01', milestone: 'm1' }),
    issue('I2', { due: '2026-11-05' }),
    issue('I3', { due: '2026-11-01', status: status('done') }),
    issue('I4', { due: '2026-11-01', archived: true }),
    issue('I5', { due: '2026-12-01' }),
  ]
  const degraded = review({ epics: null, issues })
  assert.equal(degraded.epics, null)
  assert.deepEqual(degraded.lateIssues.map((r) => [r.id, r.delayDays, r.milestone]), [['I1', 6, 'm1'], ['I2', 2, null]])
  assert.equal(degraded.incomplete, true)
  assert.equal(review({ issues }).lateIssues, null)
})

test('an empty portfolio is complete and every section says none', () => {
  const report = review()
  assert.deepEqual([report.epics, report.milestones, report.noRecentUpdates, report.updatesNotChecked], [[], [], [], []])
  assert.equal(report.incomplete, false)
  const text = roadmapReviewText(report)
  assert.match(text, /^roadmap review on 2026-11-07: status updates due every 14 days\n/)
  assert.match(text, /epics\nnone/)
  assert.match(text, /milestones\nnone/)
  assert.match(text, /epics with no recent status update\nnone/)
})

test('the text shows the tables, unknown health, the not checked epics and incompleteness', () => {
  const report = review({
    epics: [epic('E1', { target: '2026-11-01' }), epic('E2')],
    updatesByEpic: { E1: [], E2: null },
    milestones: [{ id: 'm1', name: 'M1', due: '2026-11-01' }],
  })
  const text = roadmapReviewText(report)
  assert.match(text, /\nincomplete: /)
  assert.match(text, /epics \(2\)/)
  assert.match(text, /milestones \(1\)/)
  assert.match(text, /epics with no recent status update \(1\)/)
  assert.match(text, /not checked: E2/)
  assert.match(text, /unknown/)
  assert.doesNotMatch(text, /late issues/)
  assert.match(roadmapReviewText({ ...report, epics: null, lateIssues: [] }), /epics\nnot checked: /)
  assert.match(roadmapReviewText({ ...report, epics: null, lateIssues: [] }), /late issues\nnone/)
})

test('a failed epic list is not checked and shows no late-issues fallback; an unsupported one keeps it', () => {
  const issues = [issue('I1', { due: '2026-11-01' })]
  const failed = review({ epics: null, issues, sectionErrors: { epics: 'UPSTREAM' } })
  assert.deepEqual(failed.unavailable, { epics: 'UPSTREAM', milestones: null })
  assert.equal(failed.lateIssues, null)
  assert.equal(failed.incomplete, true)
  const text = roadmapReviewText(failed)
  assert.match(text, /epics\nnot checked: the tracker failed to list epics \(UPSTREAM\), see the warnings/)
  assert.doesNotMatch(text, /cannot list epics|late issues/)
  const unsupported = review({ epics: null, issues, sectionErrors: { epics: 'NOT_SUPPORTED' } })
  assert.equal(unsupported.unavailable.epics, 'NOT_SUPPORTED')
  assert.equal(unsupported.lateIssues.length, 1)
  assert.match(roadmapReviewText(unsupported), /cannot list epics/)
})

test('a failed milestone list says it failed, not that the tracker cannot list milestones', () => {
  const report = review({ milestones: null, sectionErrors: { milestones: 'RATE_LIMITED' } })
  assert.equal(report.unavailable.milestones, 'RATE_LIMITED')
  assert.match(roadmapReviewText(report), /milestones\nnot checked: the tracker failed to list milestones \(RATE_LIMITED\), see the warnings/)
})

test('an unknown milestone delay reads unknown in the text, an on-time one stays blank', () => {
  const report = review({
    milestones: [{ id: 'bad', name: 'bad', unreadable: true }, { id: 'ok', name: 'Ok', due: '2026-12-01' }, { id: 'none', name: 'None' }],
    issues: [issue('I1', { milestone: 'ghost' })],
  })
  const lines = roadmapReviewText(report).split('\n')
  const delay = (id) => lines.find((l) => l.startsWith(`${id} `)).split('|').at(-1).trim()
  assert.deepEqual(['bad', 'ghost', 'ok', 'none'].map(delay), ['unknown', 'unknown', '', ''])
})

test('a Linear epic lists each of its milestones by name', () => {
  const report = review({
    epics: [epic('P1'), epic('P2', { milestone: 'm9' })],
    milestones: [{ id: 'm1', name: 'Alpha', due: '2026-11-15', epic: 'P1' }, { id: 'm2', name: 'Beta', due: '2026-12-15', epic: 'P1' }, { id: 'm9', name: 'Nine' }],
  })
  assert.deepEqual(row(report, 'P1').milestones, [{ id: 'm1', name: 'Alpha' }, { id: 'm2', name: 'Beta' }])
  assert.equal(row(report, 'P1').milestone, 'm1')
  assert.deepEqual(row(report, 'P2').milestones, [{ id: 'm9', name: 'Nine' }])
  assert.match(roadmapReviewText(report), /\| Alpha, Beta /)
})

test('a todo epic started within the window is not unchecked, one started before it is', () => {
  const report = review({
    epics: [epic('S1', { status: status('todo'), start: '2026-11-04' }), epic('S2', { status: status('todo'), start: '2026-10-01' })],
    updatesByEpic: { S1: null, S2: null },
  })
  assert.deepEqual(report.updatesNotChecked, ['S2'])
})
