import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankSimilar } from './similar.mjs'

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
