import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareWrites, removedLines } from './adr-write-compare.mjs'

test('removedLines counts lines as a multiset of trimmed non-blank lines', () => {
  assert.deepEqual(removedLines('## Status\n\n a\na\nb\n', '## Status\n\na\n'), ['a', 'b'])
  assert.deepEqual(removedLines('x\n', 'x\nnew\n'), [])
})

test('both refuse and a base that writes while the head refuses are their own outcomes', () => {
  assert.equal(compareWrites({ base: { refused: true }, head: { refused: true }, headStatus: 'a' }).outcome, 'refusedBoth')
  assert.equal(compareWrites({ base: { removed: ['a'] }, head: { refused: true }, headStatus: 'a' }).outcome, 'newlyRefused')
})

test('the head status line is not extra text when the base refused', () => {
  assert.equal(compareWrites({ base: { refused: true }, head: { removed: ['Accepted'] }, headStatus: 'Accepted' }).outcome, 'acceptedWhereRefused')
  const worse = compareWrites({ base: { refused: true }, head: { removed: ['Accepted', 'Date: 1'] }, headStatus: 'Accepted' })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['Date: 1']])
})

test('both write: text only the head removes is worse, counted as a multiset', () => {
  assert.equal(compareWrites({ base: { removed: ['a', 'a'] }, head: { removed: ['a'] }, headStatus: 'a' }).outcome, 'same')
  const worse = compareWrites({ base: { removed: ['a'] }, head: { removed: ['a', 'a'] }, headStatus: 'b' })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['a']])
})

test('a head that removes nothing is not worse (empty section)', () => {
  assert.equal(compareWrites({ base: { removed: [] }, head: { removed: [] }, headStatus: '' }).outcome, 'same')
})

test('an exception is its own outcome, never a refusal or a removal', () => {
  const headThrew = compareWrites({ base: { removed: ['a'] }, head: { threw: 'boom' }, headStatus: 'a' })
  assert.deepEqual([headThrew.outcome, headThrew.error], ['headThrew', 'boom'])
  assert.equal(compareWrites({ base: { refused: true }, head: { threw: 'boom' }, headStatus: 'a' }).outcome, 'headThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: { threw: 'boom' }, headStatus: '' }).outcome, 'headThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: { removed: ['a'] }, headStatus: 'a' }).outcome, 'baseThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: { refused: true }, headStatus: '' }).outcome, 'baseThrew')
})
