import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankSimilar, similarResult } from './similar.mjs'

const issue = (id, title, description = '', criteria = []) => ({ id, title, description, acceptanceCriteria: criteria.map((text) => ({ text, done: false })) })

const target = issue('A-1', 'Export invoices to CSV', 'Add a CSV export of the invoice list.')
const pool = [
  issue('A-2', 'Export customers to CSV', 'CSV export of the customer list.'),
  issue('A-3', 'Fix login redirect', 'The login page redirects twice.'),
  issue('A-4', 'Invoice rounding', 'Totals of the invoice are rounded wrong.'),
]

test('ranks the closest issue first and drops issues that share nothing', () => {
  const found = rankSimilar(target, pool)
  assert.deepEqual(found.map((hit) => hit.issue.id), ['A-2', 'A-4'])
  assert.ok(found[0].score > found[1].score && found[1].score > 0 && found[0].score <= 1)
})

test('lists the shared terms, heaviest first, at most five', () => {
  const [hit] = rankSimilar(target, pool)
  assert.ok(hit.shared.includes('csv') && hit.shared.length <= 5)
})

test('never lists the target itself and honors the limit', () => {
  assert.deepEqual(rankSimilar(target, [target, ...pool], { limit: 1 }).map((hit) => hit.issue.id), ['A-2'])
})

test('a word every issue has ranks below a distinctive one', () => {
  const found = rankSimilar(issue('B-1', 'thing report', 'thing'), [issue('B-2', 'thing', 'thing'), issue('B-3', 'report', 'thing thing')])
  assert.equal(found[0].issue.id, 'B-3')
})

test('acceptance criteria count and CRLF does not split a word', () => {
  const found = rankSimilar(issue('C-1', 'Alpha', '', ['webhook\r\nretry']), [issue('C-2', 'Beta', '', ['webhook retry'])])
  assert.deepEqual(found.map((hit) => hit.issue.id), ['C-2'])
})

test('a target with no usable text has no hits', () => {
  assert.deepEqual(rankSimilar(issue('D-1', 'a'), pool), [])
})

const withFields = (id, title, estimate) => ({ ...issue(id, title), status: { name: 'done', category: 'done' }, assignee: 'ana', estimate })

test('similarResult is complete only when the read had no problems and no more issues', () => {
  const found = { issues: [withFields('A-2', 'Export customers to CSV', 3)], problems: [] }
  const ok = similarResult(target, found)
  assert.deepEqual([ok.complete, ok.hasMore, ok.considered], [true, false, 1])
  assert.deepEqual(ok.similar.map((s) => [s.id, s.estimate, s.status.name]), [['A-2', 3, 'done']])
  assert.equal(similarResult(target, { ...found, hasMore: true }).complete, false)
  const bad = similarResult(target, { ...found, problems: [{ id: 'A-9', code: 'INVALID', message: 'no parse' }] })
  assert.deepEqual([bad.complete, bad.problems.length], [false, 1])
})

test('similarResult keeps an issue with no estimate and reports it as null, not zero', () => {
  const r = similarResult(target, { issues: [withFields('A-2', 'Export customers to CSV', undefined)], problems: [] })
  assert.equal(r.unestimated[0].estimate, null)
  assert.deepEqual(r.similar, [])
})

test('plural endings match: deliveries and delivery are one term', () => {
  assert.deepEqual(rankSimilar(issue('E-1', 'Retry deliveries'), [issue('E-2', 'Delivery log')]).map((hit) => hit.shared), [['delivery']])
})

test('a target with no usable words cannot be compared: incomplete, with a reason (PMK-216 review)', () => {
  const r = similarResult(issue('F-1', 'UI'), { issues: [withFields('F-2', 'Fix UI', 2)], problems: [] })
  assert.deepEqual([r.similar, r.complete, r.reason], [[], false, 'no_comparable_text'])
  assert.equal(similarResult(target, { issues: [], problems: [] }).reason, undefined)
})

test('hits with no estimate do not use the limit; they are listed apart', () => {
  const found = { issues: [withFields('A-2', 'Export customers to CSV', undefined), withFields('A-5', 'Export orders to CSV', 3), withFields('A-6', 'Export users to CSV', 5)], problems: [] }
  const r = similarResult(target, found, { limit: 2 })
  assert.deepEqual(r.similar.map((s) => s.id).sort(), ['A-5', 'A-6'])
  assert.deepEqual(r.unestimated.map((s) => s.id), ['A-2'])
})

test('equal scores sort by issue number, not by text', () => {
  const same = (id) => issue(id, 'Export CSV')
  assert.deepEqual(rankSimilar(issue('G-1', 'Export CSV'), [same('G-10'), same('G-9')]).map((h) => h.issue.id), ['G-9', 'G-10'])
})
