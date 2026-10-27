import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNotes, chooseBasis } from './lib/release-notes.mjs'

const rel = (id, fields) => ({ id, name: id, state: 'released', released: '2026-10-01T10:00:00Z', ...fields })
const spr = (id, fields) => ({ id, name: id, state: 'closed', start: '2026-09-01', end: '2026-09-14', ...fields })
const base = { selector: null, releases: [], sprints: [], today: '2026-10-23', windowDays: 14 }

test('a selector gives the requested reason and no skipped steps', () => {
  const planned = rel('1.0.0', { state: 'planned', released: undefined })
  const a = chooseBasis({ ...base, selector: { release: planned } })
  assert.equal(a.basis, 'release')
  assert.equal(a.reason, 'requested')
  assert.equal(a.draft, true)
  assert.deepEqual(a.source, planned)
  assert.equal(a.period, null)
  assert.deepEqual(a.skipped, [])
  assert.equal(chooseBasis({ ...base, selector: { release: rel('1.0.0') } }).draft, false)
  const active = chooseBasis({ ...base, selector: { sprint: spr('s', { state: 'active' }) } })
  assert.equal(active.basis, 'sprint')
  assert.equal(active.draft, true)
  assert.equal(chooseBasis({ ...base, selector: { sprint: spr('s') } }).draft, false)
  const since = chooseBasis({ ...base, selector: { since: '2026-10-01' } })
  assert.equal(since.basis, 'period')
  assert.deepEqual(since.period, { since: '2026-10-01', until: '2026-10-23', defaulted: false })
  assert.equal(since.source, null)
  assert.equal(since.draft, false)
  assert.equal(chooseBasis({ ...base, selector: { since: '2026-10-01', until: '2026-10-05' } }).period.until, '2026-10-05')
})

test('no selector takes the released release with the latest released time', () => {
  const releases = [rel('1.0.0'), rel('1.1.0', { state: 'planned' }), rel('0.9.0', { released: '2026-10-10T10:00:00Z' })]
  const choice = chooseBasis({ ...base, releases: [releases[2], releases[0], releases[1]] })
  assert.equal(choice.source.id, '0.9.0')
  assert.equal(choice.reason, 'latest')
  assert.deepEqual(choice.skipped, [])
  assert.equal(choice.draft, false)
})

test('two releases with one released time go to the later one in list order', () => {
  const choice = chooseBasis({ ...base, releases: [rel('1.0.1'), rel('1.0.2')] })
  assert.equal(choice.source.id, '1.0.2')
})

test('no released release falls to the closed sprint with the latest end', () => {
  const releases = [rel('1.0.0', { state: 'planned' })]
  const sprints = [spr('a'), spr('b', { end: '2026-09-28' }), spr('c', { state: 'active', end: '2026-10-12' })]
  const choice = chooseBasis({ ...base, releases, sprints })
  assert.equal(choice.basis, 'sprint')
  assert.equal(choice.source.id, 'b')
  assert.equal(choice.reason, 'no_released_release')
  assert.deepEqual(choice.skipped, [{ basis: 'release', reason: 'no_released_release' }])
  const tie = chooseBasis({ ...base, releases, sprints: [spr('x'), spr('y')] })
  assert.equal(tie.source.id, 'y')
})

test('a tracker without releases falls to the sprint with releases_absent', () => {
  const choice = chooseBasis({ ...base, releases: null, sprints: [spr('a')] })
  assert.equal(choice.basis, 'sprint')
  assert.equal(choice.reason, 'releases_absent')
  assert.deepEqual(choice.skipped, [{ basis: 'release', reason: 'releases_absent' }])
})

test('with no closed sprint the period is the last windowDays days', () => {
  const releases = [rel('1.0.0', { state: 'planned' })]
  const choice = chooseBasis({ ...base, releases })
  assert.equal(choice.basis, 'period')
  assert.deepEqual(choice.period, { since: '2026-10-09', until: '2026-10-23', defaulted: true })
  assert.equal(choice.reason, 'no_closed_sprint')
  assert.equal(choice.source, null)
  assert.deepEqual(choice.skipped, [{ basis: 'release', reason: 'no_released_release' }, { basis: 'sprint', reason: 'no_closed_sprint' }])
  const absent = chooseBasis({ ...base, releases: null, sprints: null })
  assert.deepEqual(absent.skipped.map((s) => s.reason), ['releases_absent', 'no_closed_sprint'])
  assert.equal(chooseBasis({ ...base, releases, windowDays: 7 }).period.since, '2026-10-16')
})

test('the period math crosses a month and a year', () => {
  assert.equal(chooseBasis({ ...base, today: '2026-01-05' }).period.since, '2025-12-22')
})

const iss = (id, fields) => ({ id, title: id, description: '', type: 'task', labels: [], parent: null, archived: false, release: null, created: '2026-10-01T10:00:00Z', status: { name: 'done', category: 'done' }, ...fields })
const cand = (issue, doneAt = null) => ({ issue, doneAt })
const choice = chooseBasis({ ...base, selector: { release: rel('1.0.0') } })
const types = ['feature', 'bug', 'task', 'chore']
const open = { name: 'in_progress', category: 'in_progress' }

test('done issues are grouped by type in the order of types, and an empty group is dropped', () => {
  const candidates = [
    cand(iss('B2', { type: 'bug', created: '2026-10-03T10:00:00Z' })),
    cand(iss('F1', { type: 'feature' })),
    cand(iss('B1', { type: 'bug', created: '2026-10-02T10:00:00Z' })),
  ]
  const result = buildNotes({ choice, candidates, types })
  assert.deepEqual(result.groups.map((g) => g.type), ['feature', 'bug'])
  assert.deepEqual(result.groups[1].issues.map((i) => i.id), ['B1', 'B2'])
  assert.deepEqual(result.counts, { done: 3, excluded: { open: 0, canceled: 0, chore: 0 } })
})

test('an entry holds the listed fields and keeps the doneAt it was given', () => {
  const issue = iss('F1', { type: 'feature', description: 'Retries now stop after 5 tries.', labels: ['backend'], parent: 'EPC-1', archived: true, release: '1.0.0' })
  const result = buildNotes({ choice, candidates: [cand(issue, '2026-10-06T16:00:00Z')], types })
  assert.deepEqual(result.groups[0].issues[0], {
    id: 'F1', title: 'F1', description: 'Retries now stop after 5 tries.', type: 'feature', labels: ['backend'], parent: 'EPC-1', archived: true, doneAt: '2026-10-06T16:00:00Z', release: '1.0.0',
  })
})

test('open and canceled issues are counted, never listed', () => {
  const candidates = [
    cand(iss('D')),
    cand(iss('P', { status: open })),
    cand(iss('T', { status: { name: 'todo', category: 'todo' } })),
    cand(iss('C', { status: { name: 'canceled', category: 'canceled' } })),
  ]
  const result = buildNotes({ choice, candidates, types })
  assert.equal(result.counts.done, 1)
  assert.deepEqual(result.counts.excluded, { open: 2, canceled: 1, chore: 0 })
})

test('a done chore is left out and counted', () => {
  const result = buildNotes({ choice, candidates: [cand(iss('H', { type: 'chore' })), cand(iss('T'))], types })
  assert.equal(result.counts.done, 1)
  assert.equal(result.counts.excluded.chore, 1)
  const notDone = buildNotes({ choice, candidates: [cand(iss('H', { type: 'chore', status: open }))], types })
  assert.deepEqual(notDone.counts.excluded, { open: 1, canceled: 0, chore: 0 })
})

test('a done issue reopened inside the period is not listed', () => {
  const result = buildNotes({ choice, candidates: [cand(iss('R', { status: open }), '2026-10-05T10:00:00Z')], types })
  assert.deepEqual(result.groups, [])
  assert.equal(result.counts.excluded.open, 1)
})

test('an issue with no type or an unknown type goes to a last group with type null', () => {
  const candidates = [
    cand(iss('U2', { type: 'epic-ish', created: '2026-10-03T10:00:00Z' })),
    cand(iss('U1', { type: null, created: '2026-10-02T10:00:00Z' })),
    cand(iss('B', { type: 'bug' })),
  ]
  const result = buildNotes({ choice, candidates, types })
  assert.deepEqual(result.groups.map((g) => g.type), ['bug', null])
  assert.deepEqual(result.groups[1].issues.map((i) => i.id), ['U1', 'U2'])
})

test('no done issue gives no groups', () => {
  const result = buildNotes({ choice, candidates: [cand(iss('H', { type: 'chore' })), cand(iss('P', { status: open }))], types })
  assert.deepEqual(result.groups, [])
  assert.equal(result.counts.done, 0)
})

test('the result keeps the choice fields and the problems in order', () => {
  const problems = [{ id: 'X', code: 'NOT_FOUND', message: 'gone' }]
  const result = buildNotes({ choice, candidates: [], types, problems })
  assert.deepEqual(Object.keys(result), ['basis', 'reason', 'draft', 'source', 'period', 'groups', 'counts', 'skipped', 'problems'])
  assert.deepEqual(result.problems, problems)
  assert.deepEqual(buildNotes({ choice, candidates: [], types }).problems, [])
})
