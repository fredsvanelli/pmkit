import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseBasis } from './lib/release-notes.mjs'

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
