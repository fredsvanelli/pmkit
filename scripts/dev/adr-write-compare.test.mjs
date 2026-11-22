import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { ADR_STATUSES, adrKeptLines, adrStatusDropped, setAdrStatus } from '../lib/adr.mjs'
import { HTML_CONTAINERS, KNOWN_STATUS, ONE_SPACE, STATUS_BREAKS, STATUS_NEAR, breakPairs, breakRuns, breakTriples, cases, compareWrites, expectedLine, hardBreak, readsAsStatus, removedLines, oneSpacePairs, statusBreakPairs, statusBreakTriples, writeShape } from './adr-write-compare.mjs'

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

test('the helper copy reads an ordered list item as a status as scripts/lib/adr.mjs does (PMK-328)', () => {
  // adr.mjs refuses a status followed by another line that reads as a known status, so the refusal says how it reads each line.
  const reads = ['1. Proposed', '1) Proposed', '10. Proposed', '1.\tProposed', '> 1. Proposed', '- 1. Proposed']
  const not = ['1.Accepted', 'see 1. Proposed', '**1. Accepted**', '1234567890. Proposed', '(1) x']
  for (const line of [...reads, ...not]) {
    const refused = adrStatusDropped(`## Status\n\nAccepted\n\n${line}\n\n## Context\n`).length > 0
    assert.equal(readsAsStatus(line), reads.includes(line), JSON.stringify(line))
    assert.equal(refused, reads.includes(line), JSON.stringify(line))
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

test('the corpus writes over status lines with a hard break in pairs, triples and random runs (PMK-324)', () => {
  // Only the status lines of STATUS_BREAKS count (an underline such as `----  ` must not stand in for them), classified by the helper's own `hardBreak`:
  // a space break, a backslash break and an even run of backslashes that is not a break, each in each part, so a later edit cannot drop them.
  const kind = (line) => (hardBreak(line) === '\\' ? 'backslash' : hardBreak(line) ? 'spaces' : line.endsWith('\\') ? 'two backslashes' : 'none')
  for (const [part, bodies] of [['pairs', breakPairs()], ['triples', breakTriples()], ['random runs', breakRuns({ seed: 1, count: 2000, lines: 8 })]]) {
    const seen = new Set()
    for (const body of bodies) for (const line of body.split('\n')) if (STATUS_BREAKS.includes(line)) seen.add(kind(line))
    assert.deepEqual([...seen].sort(), ['backslash', 'spaces', 'two backslashes'], part)
  }
})

test('the cases before PMK-324 are the same and in the same order as in the script before the corpus moved (PMK-324)', () => {
  // The sha256 of `JSON.stringify(case) + '\n'` for each case of `cases()` in adr-commonmark-diff.mjs at 3fb6707b (before the move), with --seed 1 --random 2000 --status-random 2000 --lines 8:
  // the fixed cases, the pairs and triples, the first 2,000 of each random part (each part has its own seed) and the container cases, 1,194,400 in all. The PMK-324 cases come after them.
  const hash = createHash('sha256')
  let n = 0
  for (const item of cases({ seed: 1, random: 2000, statusRandom: 2000, breakRandom: 0, lines: 8 })) {
    if (n++ === 1194400) break
    hash.update(`${JSON.stringify(item)}\n`)
  }
  assert.equal(n, 1194401)
  assert.equal(hash.digest('hex'), '9f2f6b6c75dd2f2b93b9b11b8a1616bc7111b3d68bdbf4fbaa62913a83a8fdf5')
})

test('each generator loop of the corpus has its own size, so dropping one fails (PMK-327)', () => {
  const count = (items) => { let n = 0; for (const _ of items) n++; return n }
  // 151 = 33 status lines (STATUS_ALL) + 118 ALPHABET lines; 513 = 33 * 33 - 24 * 24 status pairs with a break; 26 = STATUSY + ONE_SPACE; 9 STATUS_BREAKS; 7 UNDERLINES.
  assert.equal(count(breakPairs()), 9 * 151 * 7 + 118 * 9 * 7)
  assert.equal(count(breakTriples()), 513 * 151 * 7 + 513 * 118 * 7)
  assert.equal(count(statusBreakPairs()), 26 * 9 * 7)
  assert.equal(count(statusBreakTriples()), 26 * 26 * 9 * 7)
  // 2 ONE_SPACE lines before each of the 151 lines, and after each of the 118 ALPHABET lines.
  assert.equal(count(oneSpacePairs()), 2 * 151 * 7 + 118 * 2 * 7)
  // 2 statuses, with and without a blank line, 5 kinds after `> ` and `- `, 6 ends.
  assert.equal(HTML_CONTAINERS.length, 2 * 2 * 10 * 6)
  // Every loop of `cases`: 2,173,356 cases before PMK-327 with these counts, then 240 + 1,638 + 42,588.
  assert.equal(count(cases({ seed: 1, random: 10, statusRandom: 10, breakRandom: 10, lines: 8 })), 2173356 + 240 + 1638 + 42588 + 3766)
})

test('the corpus holds HTML blocks of kinds 1 to 5 in containers, status lines before a break and one-space status lines (PMK-327)', () => {
  const ends = ['later line', 'blank', 'ATX heading', 'setext heading', 'end of file', 'end of file, no final newline']
  for (const open of ['<!-- x', '<?php', '<![CDATA[', '<!X', '<script>']) for (const prefix of ['> ', '- ']) for (const end of ends) {
    const found = HTML_CONTAINERS.filter((item) => item.end === end && item.text.split('\n').includes(prefix + open))
    assert.equal(found.length, 4, JSON.stringify([open, prefix, end]))
    for (const item of found) assert.equal(item.text.endsWith('\n'), end !== 'end of file, no final newline')
  }
  // A status line: a PMK-315 one (STATUSY) or a one-space one, never a break line.
  const isStatus = (line) => STATUS_NEAR.includes(line) && !STATUS_BREAKS.includes(line)
  assert.equal(STATUS_NEAR.length, 26)
  for (const body of statusBreakPairs()) {
    const [s, b] = body.split('\n')
    assert.ok(isStatus(s) && STATUS_BREAKS.includes(b), body)
  }
  for (const body of statusBreakTriples()) {
    const [s, t, b] = body.split('\n')
    assert.ok(isStatus(s) && isStatus(t) && STATUS_BREAKS.includes(b), body)
  }
  const firstLines = new Set([...statusBreakPairs()].map((body) => body.split('\n')[0]))
  for (const line of ONE_SPACE) {
    assert.ok(/[^ ] $/.test(line) && hardBreak(line) === '' && readsAsStatus(line), line)
    assert.ok(firstLines.has(line), line)
    // setAdrStatus writes in place only over the one status line of a section: a one-space line has to be the only one, or a write that keeps its space passes.
    assert.ok([...oneSpacePairs()].some((body) => body.startsWith(`${line}\nDate: 2024-01-02\n`)), line)
    assert.ok([...oneSpacePairs()].some((body) => body.startsWith(`lazy\n${line}\n`)), line)
  }
})
