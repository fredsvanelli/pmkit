import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ADR_STATUSES, adrKeptLines, setAdrStatus } from '../lib/adr.mjs'
import { KNOWN_STATUS, compareWrites, expectedLine, hardBreak, readsAsStatus, removedLines, writeShape } from './adr-write-compare.mjs'

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

const cmp = (args) => compareWrites({ span: [1, 4], status: SENTINEL, ...args })
// An in-place write puts the requested status on the old line with its indent and hard line break kept (PMK-321); `newLine` overrides it.
const inPlace = (line, at = 2, newLine = expectedLine(line, SENTINEL)) => ({ removed: [line], rewritten: [line], written: [SENTINEL], inPlace: true, at, oldLine: line, newLine })
const whole = (...lines) => ({ removed: lines, rewritten: lines, written: [SENTINEL], inPlace: false, outside: true })

test('both refuse and a base that writes while the head refuses are their own outcomes', () => {
  assert.equal(cmp({ base: { refused: true }, head: { refused: true }, section: [] }).outcome, 'refusedBoth')
  assert.equal(cmp({ base: whole('a'), head: { refused: true }, section: ['a'] }).outcome, 'newlyRefused')
})

test('a legitimate in-place write is not worse, with and without a hard line break', () => {
  assert.equal(cmp({ base: { refused: true }, head: inPlace('Accepted'), section: ['Accepted', 'Date: 1'] }).outcome, 'acceptedWhereRefused')
  assert.equal(cmp({ base: whole('Accepted', 'Date: 1'), head: inPlace('Accepted  '), section: ['Accepted', 'Date: 1'] }).outcome, 'same')
})

test('the head replacing a line that is not a known status is worse (the line it picks does not excuse it)', () => {
  const worse = cmp({ base: { refused: true }, head: whole('Date: 2024-01-02'), section: ['Accepted', 'Date: 2024-01-02'] })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['Date: 2024-01-02']])
  // Replacing only the Date line is a whole-section write only when the section is that one line, even when the base wrote the same line.
  assert.equal(cmp({ base: whole('Date: 2024-01-02'), head: whole('Date: 2024-01-02'), section: ['Accepted', 'Date: 2024-01-02'] }).outcome, 'worse')
  assert.equal(cmp({ base: whole('Date: 2024-01-02'), head: whole('Date: 2024-01-02'), section: ['Date: 2024-01-02'] }).outcome, 'same')
})

test('a duplicated, reordered or moved line is worse, even when the base wrote the same removal', () => {
  const written = { removed: ['Accepted'], rewritten: ['Accepted'], inPlace: false, outside: true }
  for (const lines of [[SENTINEL, 'Date: x', 'Date: x'], ['Date: x', SENTINEL], [SENTINEL, '## Context', 'Date: x']]) {
    for (const base of [{ refused: true }, { removed: ['Accepted'] }]) {
      assert.equal(cmp({ base, head: { ...written, written: lines }, section: ['Accepted', 'Date: x'] }).outcome, 'worse', JSON.stringify(lines))
    }
  }
})

test('a whole-section replacement: the one line of a one-line section is not extra, a longer section is compared with the base', () => {
  assert.equal(cmp({ base: { refused: true }, head: whole('Date: 1'), section: ['Date: 1'] }).outcome, 'acceptedWhereRefused')
  assert.equal(cmp({ base: whole('Date: 1'), head: whole('Date: 1'), section: ['Date: 1'] }).outcome, 'same')
  assert.equal(cmp({ base: { refused: true }, head: whole('a', 'b'), section: ['a', 'b'] }).outcome, 'worse')
  const worse = cmp({ base: whole('a'), head: whole('a', 'b'), section: ['a', 'b'] })
  assert.deepEqual([worse.outcome, worse.extra], ['worse', ['b']])
})

test('a head that removes nothing is not worse (empty section)', () => {
  assert.equal(cmp({ base: { removed: [] }, head: { removed: [], rewritten: [], written: [SENTINEL], inPlace: false, outside: true }, section: [] }).outcome, 'same')
})

test('an exception is its own outcome, never a refusal or a removal', () => {
  const headThrew = cmp({ base: whole('a'), head: { threw: 'boom' }, section: [] })
  assert.deepEqual([headThrew.outcome, headThrew.error], ['headThrew', 'boom'])
  assert.equal(cmp({ base: { refused: true }, head: { threw: 'boom' }, section: [] }).outcome, 'headThrew')
  assert.equal(cmp({ base: { threw: 'boom' }, head: { threw: 'boom' }, section: [] }).outcome, 'headThrew')
  assert.equal(cmp({ base: { threw: 'boom' }, head: whole('a'), section: ['a'] }).outcome, 'baseThrew')
  assert.equal(cmp({ base: { threw: 'boom' }, head: { refused: true }, section: [] }).outcome, 'baseThrew')
})

test('writeShape gives the raw line of an in-place write', () => {
  assert.equal(shape('Accepted\nDate: x', inPlaceAfter('Accepted\nDate: x', 'Accepted', SENTINEL)).at, 2)
})

test('an in-place write of a known status line outside the Status section is worse (PMK-318 review)', () => {
  const before = '## Status\n\nAccepted\nDate: x\n## X\nAccepted\n## Context\n'
  const section = ['Accepted', 'Date: x']
  const span = [1, 4]
  const outside = writeShape(before, before.replace('\nAccepted\n## Context', `\n${SENTINEL}\n## Context`))
  assert.deepEqual([outside.inPlace, outside.at], [true, 5])
  for (const base of [{ refused: true }, whole('Accepted')]) {
    const worse = compareWrites({ base, head: outside, section, span, status: SENTINEL })
    assert.deepEqual([worse.outcome, worse.extra], ['worse', ['Accepted']])
  }
  const inside = writeShape(before, before.replace('Accepted\nDate', `${SENTINEL}\nDate`))
  assert.deepEqual([inside.inPlace, inside.at], [true, 2])
  assert.equal(compareWrites({ base: { refused: true }, head: inside, section, span, status: SENTINEL }).outcome, 'acceptedWhereRefused')
  // The Status heading itself is not the section, and the line after its end is not either.
  assert.equal(compareWrites({ base: { refused: true }, head: inPlace('Accepted', 0), section, span, status: SENTINEL }).outcome, 'worse')
  assert.equal(compareWrites({ base: { refused: true }, head: inPlace('Accepted', 4), section, span, status: SENTINEL }).outcome, 'worse')
})

test('the helper copy of the known status rule has not drifted from scripts/lib/adr.mjs', () => {
  // The set: adr.mjs builds it as ADR_STATUSES plus the words listed in its source.
  const source = fs.readFileSync(new URL('../lib/adr.mjs', import.meta.url), 'utf8')
  const extra = /const KNOWN_STATUS = new Set\(\[\.\.\.ADR_STATUSES((?:, '[a-z]+')+)\]\)/.exec(source)
  assert.ok(extra, 'KNOWN_STATUS of adr.mjs has a new shape: update the helper copy and this test')
  const theirs = new Set([...ADR_STATUSES, ...[...extra[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1])])
  assert.deepEqual([...KNOWN_STATUS].sort(), [...theirs].sort())
  // The rule: adr.mjs keeps the other lines of a section (adrKeptLines is not empty) only when its top-level line reads as a known status.
  const lines = [...KNOWN_STATUS, 'date', 'status', 'accept', 'supersedes ADR 1', 'unknown'].flatMap((word) => [word, `**${word}**`, `_${word}_ x`, `${word}.`, `  ${word.toUpperCase()}`, `Superseded by ADR 2`])
  for (const line of lines) {
    const kept = adrKeptLines(`## Status\n\n${line}\nDate: x\n## Context\n`).length > 0
    assert.equal(readsAsStatus(line), kept, JSON.stringify(line))
  }
})

test('writeShape gives the raw old and new line of an in-place write', () => {
  const body = '  Accepted  \nDate: x'
  const placed = shape(body, inPlaceAfter(body, 'Accepted', 'Superseded by sentinel.md'))
  assert.deepEqual([placed.inPlace, placed.oldLine, placed.newLine], [true, '  Accepted  ', '  Superseded by sentinel.md  '])
})

test('an in-place write puts the requested status with the indent and hard line break of the old line, anything else is worse (PMK-321)', () => {
  const section = ['Accepted', 'Date: 1']
  const base = { refused: true }
  const outcome = (line, newLine) => cmp({ base, head: inPlace(line, 2, newLine), section }).outcome
  assert.equal(outcome('Accepted'), 'acceptedWhereRefused')
  assert.equal(outcome('  Accepted  '), 'acceptedWhereRefused')
  assert.equal(outcome('**Accepted**\\'), 'acceptedWhereRefused')
  for (const [line, wrong] of [['Accepted', ''], ['Accepted', 'foo'], ['Accepted', 'Superseded by x'], ['Accepted', ' Superseded by sentinel.md'], ['Accepted', 'Superseded by sentinel.md  '],
    ['Accepted  ', 'Superseded by sentinel.md'], ['  Accepted', 'Superseded by sentinel.md'], ['  Accepted', '    Superseded by sentinel.md'], ['Accepted\\', 'Superseded by sentinel.md'], ['Accepted', 'Accepted']]) {
    assert.equal(outcome(line, wrong), 'worse', JSON.stringify([line, wrong]))
    assert.equal(cmp({ base: whole('Accepted', 'Date: 1'), head: inPlace(line, 2, wrong), section }).outcome, 'worse')
  }
})

test('writeShape says whether the raw lines outside the span are unchanged', () => {
  const before = '## Status\n\nDate: 1\n## Context\n    indented\n'
  const section = (after) => writeShape(before, after, [1, 3]).outside
  assert.equal(section(`## Status\n\n${SENTINEL}\n\n## Context\n    indented\n`), true)
  assert.equal(section(`## Status\n\n${SENTINEL}\n\n## Context\nindented\n`), false)
  assert.equal(section(`## Status\n\n${SENTINEL}\n\n## Context\n    indented \n`), false)
  assert.equal(section(`## Status \n\n${SENTINEL}\n\n## Context\n    indented\n`), false)
  // At the end of the file the span runs to the last line: nothing after it to compare.
  assert.equal(writeShape('## Status\n\nDate: 1\n', `## Status\n\n${SENTINEL}\n`, [1, 4]).outside, true)
  assert.equal(writeShape('## Status\n\nDate: 1\n', `## X\n\n${SENTINEL}\n`, [1, 4]).outside, false)
})

test('a whole-section write that changes a raw line outside the section is worse, even one that only moves its indent (PMK-321)', () => {
  const section = ['Date: 1']
  assert.equal(cmp({ base: whole('Date: 1'), head: whole('Date: 1'), section }).outcome, 'same')
  for (const base of [{ refused: true }, whole('Date: 1')]) {
    assert.equal(cmp({ base, head: { ...whole('Date: 1'), outside: false }, section }).outcome, 'worse')
    assert.equal(cmp({ base, head: { ...whole('Date: 1'), outside: undefined }, section }).outcome, 'worse')
  }
})

test('the helper copy of the hard line break rule has not drifted from scripts/lib/adr.mjs', () => {
  // adr.mjs keeps the break of the replaced line: indent + the requested status + the break, whatever the line ends with.
  const status = 'Superseded by sentinel.md'
  const ends = ['', ' ', '  ', '   ', '\t', ' \t', '\\', '\\\\', '\\\\\\', ' \\', '\\ ', '\\  ', '  \\', '\\\\ ']
  for (const indent of ['', ' ', '  ', '   ']) for (const word of ['Accepted', '**Accepted**', 'Superseded by ADR 2']) for (const end of ends) {
    const line = indent + word + end
    const wrote = setAdrStatus(doc(`${line}\nDate: x`), 'superseded', 'sentinel.md').text.split('\n')[2]
    assert.equal(wrote, expectedLine(line, status), JSON.stringify(line))
  }
  assert.deepEqual([hardBreak('a  '), hardBreak('a\\'), hardBreak('a\\\\'), hardBreak('a')], ['  ', '\\', '', ''])
})

test('a one-line section written as the plain status is a whole-section write, a longer section needs the indent and break (PMK-321)', () => {
  const base = { refused: true }
  for (const line of ['  Accepted', '    Accepted', 'Accepted  ', '**Accepted**\\', '  Accepted  ']) {
    assert.equal(cmp({ base, head: inPlace(line, 2, SENTINEL), section: [line.trim()] }).outcome, 'acceptedWhereRefused', line)
    assert.equal(cmp({ base, head: inPlace(line, 2, expectedLine(line, SENTINEL)), section: [line.trim()] }).outcome, 'acceptedWhereRefused', line)
    // Two lines in the section: the strict rule, no exception.
    assert.equal(cmp({ base, head: inPlace(line, 2, SENTINEL), section: [line.trim(), 'Date: 1'] }).outcome, expectedLine(line, SENTINEL) === SENTINEL ? 'acceptedWhereRefused' : 'worse', line)
  }
  // Even in a one-line section, anything but the plain status or the kept shape is worse.
  assert.equal(cmp({ base, head: inPlace('  Accepted', 2, 'foo'), section: ['Accepted'] }).outcome, 'worse')
  assert.equal(cmp({ base, head: inPlace('  Accepted', 2, ''), section: ['Accepted'] }).outcome, 'worse')
  assert.equal(cmp({ base, head: inPlace('Accepted  ', 2, 'Superseded by x'), section: ['Accepted'] }).outcome, 'worse')
})
