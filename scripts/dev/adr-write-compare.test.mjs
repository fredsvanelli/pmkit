import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareWrites, removedLines, writeShape } from './adr-write-compare.mjs'

const doc = (body) => `## Status\n\n${body}\n## Context\n`
const SENTINEL = 'Superseded by sentinel.md'
// The shape of the write of `body` into `after`, as `{ removed, rewritten, written, inPlace }`.
const shape = (body, after) => writeShape(doc(body), after)
const inPlaceAfter = (body, from, to) => doc(body).replace(from, to)

test('removedLines counts lines as a multiset of trimmed non-blank lines', () => {
  assert.deepEqual(removedLines('## Status\n\n a\na\nb\n', '## Status\n\na\n'), ['a', 'b'])
  assert.deepEqual(removedLines('x\n', 'x\nnew\n'), [])
})

test('writeShape: one known status line replaced in place, with or without a hard line break, is inPlace', () => {
  assert.equal(shape('Accepted\nDate: x', inPlaceAfter('Accepted\nDate: x', 'Accepted', SENTINEL)).inPlace, true)
  assert.equal(shape('Accepted  \nDate: x', inPlaceAfter('Accepted  \nDate: x', 'Accepted', 'Superseded by sentinel.md')).inPlace, true)
  assert.equal(shape('**Accepted**\\\nDate: x', inPlaceAfter('**Accepted**\\\nDate: x', '**Accepted**\\', `${SENTINEL}\\`)).inPlace, true)
  assert.equal(shape('  Accepted\nDate: x', inPlaceAfter('  Accepted\nDate: x', 'Accepted', SENTINEL)).inPlace, true)
})

test('writeShape: replacing a line that is not a known status is not inPlace', () => {
  const wrong = shape('Accepted\nDate: 2024-01-02', inPlaceAfter('Accepted\nDate: 2024-01-02', 'Date: 2024-01-02', SENTINEL))
  assert.deepEqual([wrong.inPlace, wrong.removed, wrong.rewritten, wrong.written], [false, ['Date: 2024-01-02'], ['Date: 2024-01-02'], [SENTINEL]])
})

test('writeShape: a section replaced whole has one written line and the lines it removed', () => {
  const whole = shape('Date: 2024-01-02\n', `## Status\n\n${SENTINEL}\n\n## Context\n`)
  assert.deepEqual([whole.inPlace, whole.rewritten, whole.written], [false, ['Date: 2024-01-02'], [SENTINEL]])
})

test('writeShape: a duplicated kept line has two written lines', () => {
  const dup = shape('Accepted\nDate: x', `## Status\n\n${SENTINEL}\nDate: x\nDate: x\n## Context\n`)
  assert.deepEqual([dup.inPlace, dup.removed, dup.written], [false, ['Accepted'], [SENTINEL, 'Date: x']])
})

test('writeShape: reordered lines are not inPlace and write more than one line', () => {
  const reordered = shape('Accepted\nDate: x', `## Status\n\nDate: x\n${SENTINEL}\n## Context\n`)
  assert.deepEqual([reordered.inPlace, reordered.removed, reordered.written.length], [false, ['Accepted'], 2])
})

test('writeShape: a line moved below the next heading is not inPlace and writes more than one line', () => {
  const moved = shape('Accepted\nDate: x', `## Status\n\n${SENTINEL}\n## Context\nDate: x\n`)
  assert.deepEqual([moved.inPlace, moved.removed, moved.written.length], [false, ['Accepted'], 3])
})

test('writeShape: a head that changes nothing is not inPlace and writes nothing', () => {
  const same = shape('Accepted', doc('Accepted'))
  assert.deepEqual([same.inPlace, same.rewritten, same.written], [false, [], []])
})

const inPlace = (line) => ({ removed: [line], rewritten: [line], written: [SENTINEL], inPlace: true })
const whole = (...lines) => ({ removed: lines, rewritten: lines, written: [SENTINEL], inPlace: false })

test('both refuse and a base that writes while the head refuses are their own outcomes', () => {
  assert.equal(compareWrites({ base: { refused: true }, head: { refused: true }, section: [] }).outcome, 'refusedBoth')
  assert.equal(compareWrites({ base: whole('a'), head: { refused: true }, section: ['a'] }).outcome, 'newlyRefused')
})

test('a legitimate in-place write is not worse, with and without a hard line break', () => {
  assert.equal(compareWrites({ base: { refused: true }, head: inPlace('Accepted'), section: ['Accepted', 'Date: 1'] }).outcome, 'acceptedWhereRefused')
  assert.equal(compareWrites({ base: whole('Accepted', 'Date: 1'), head: inPlace('Accepted  '), section: ['Accepted', 'Date: 1'] }).outcome, 'same')
})

test('the head replacing a line that is not a known status is worse (the line it picks does not excuse it)', () => {
  const worse = compareWrites({ base: { refused: true }, head: whole('Date: 2024-01-02'), section: ['Accepted', 'Date: 2024-01-02'] })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['Date: 2024-01-02']])
  assert.equal(compareWrites({ base: whole('Date: 2024-01-02'), head: whole('Date: 2024-01-02'), section: ['Accepted', 'Date: 2024-01-02'] }).outcome, 'same')
})

test('a duplicated, reordered or moved line is worse, even when the base wrote the same removal', () => {
  const written = { removed: ['Accepted'], rewritten: ['Accepted'], inPlace: false }
  for (const lines of [[SENTINEL, 'Date: x', 'Date: x'], ['Date: x', SENTINEL], [SENTINEL, '## Context', 'Date: x']]) {
    for (const base of [{ refused: true }, { removed: ['Accepted'] }]) {
      assert.equal(compareWrites({ base, head: { ...written, written: lines }, section: ['Accepted', 'Date: x'] }).outcome, 'worse', JSON.stringify(lines))
    }
  }
})

test('a whole-section replacement: the one line of a one-line section is not extra, a longer section is compared with the base', () => {
  assert.equal(compareWrites({ base: { refused: true }, head: whole('Date: 1'), section: ['Date: 1'] }).outcome, 'acceptedWhereRefused')
  assert.equal(compareWrites({ base: whole('Date: 1'), head: whole('Date: 1'), section: ['Date: 1'] }).outcome, 'same')
  assert.equal(compareWrites({ base: { refused: true }, head: whole('a', 'b'), section: ['a', 'b'] }).outcome, 'worse')
  const worse = compareWrites({ base: whole('a'), head: whole('a', 'b'), section: ['a', 'b'] })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['b']])
})

test('a head that removes nothing is not worse (empty section)', () => {
  assert.equal(compareWrites({ base: { removed: [] }, head: { removed: [], rewritten: [], written: [SENTINEL], inPlace: false }, section: [] }).outcome, 'same')
})

test('an exception is its own outcome, never a refusal or a removal', () => {
  const headThrew = compareWrites({ base: whole('a'), head: { threw: 'boom' }, section: [] })
  assert.deepEqual([headThrew.outcome, headThrew.error], ['headThrew', 'boom'])
  assert.equal(compareWrites({ base: { refused: true }, head: { threw: 'boom' }, section: [] }).outcome, 'headThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: { threw: 'boom' }, section: [] }).outcome, 'headThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: whole('a'), section: ['a'] }).outcome, 'baseThrew')
  assert.equal(compareWrites({ base: { threw: 'boom' }, head: { refused: true }, section: [] }).outcome, 'baseThrew')
})
