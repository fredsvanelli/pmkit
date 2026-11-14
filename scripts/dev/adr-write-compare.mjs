// Pure helpers and the corpus of adr-commonmark-diff.mjs (PMK-315, PMK-318, PMK-324), kept apart so `npm test` can run them without commonmark.

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)
/** The multiset difference `a` minus `b`, in the order of `a`. */
const minus = (a, b) => {
  const left = new Map()
  for (const item of b) left.set(item, (left.get(item) ?? 0) + 1)
  return a.filter((item) => !(left.get(item) > 0 && left.set(item, left.get(item) - 1)))
}

/** The trimmed non-blank lines of `before` that `after` no longer has, as a multiset. */
export const removedLines = (before, after) => minus(lines(before), lines(after))

// A copy of the PMK-311 rule of `scripts/lib/adr.mjs` (`readsAsStatus`: the first word of the line, emphasis and punctuation skipped, is a known status). It is a copy on purpose:
// the line a write may replace must not be chosen by the head under test, which is the defect of PMK-315. A change to the rule in adr.mjs has to change this list too.
export const KNOWN_STATUS = new Set(['accepted', 'deprecated', 'superseded', 'proposed', 'rejected', 'draft'])
export const readsAsStatus = (line) => KNOWN_STATUS.has(/^[^\p{L}\p{N}]*(\p{L}+)/u.exec(line)?.[1].toLowerCase() ?? '')

// A copy of the PMK-314 rule of `scripts/lib/adr.mjs` (`hardBreak`: two or more trailing spaces, or an odd number of trailing backslashes, which `setAdrStatus` keeps on the line it replaces), for the same reason as the copy above (PMK-321).
// A test compares `expectedLine` with what `setAdrStatus` writes; a change to the rule in adr.mjs has to change this one too.
export const hardBreak = (line) => / {2,}$/.exec(line)?.[0] ?? (((/\\+$/.exec(line)?.[0].length ?? 0) % 2 === 1) ? '\\' : '')
/** The line an in-place write of `status` puts where `oldLine` was: its indent, the status and its hard line break. */
export const expectedLine = (oldLine, status) => /^\s*/.exec(oldLine)[0] + status + hardBreak(oldLine)

/** What differs between two lists once their common start and end are cut off: `[from, to, at]`, `at` the index in `before` where `from` starts. */
const middle = (before, after) => {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  return [before.slice(head, before.length - tail), after.slice(head, after.length - tail), head]
}

/**
 * The shape of one write of `before` into `after` (PMK-318): `removed` is the multiset difference of `removedLines`; `inPlace` is true when exactly one line (raw, a hard line break and the indent included)
 * differs and the old one reads as a known status, so every other line of the document is the same, in order and byte for byte; `rewritten` and `written` are the trimmed non-blank lines the write replaced and
 * the ones it put there, with the lines both have at the start and end cut off, so a duplicated, reordered or moved line makes `written` longer than the one new status line.
 * `at` is the raw line of `before` that an in-place write replaced, `oldLine` and `newLine` that line and the one that took its place, as they are (PMK-321). With `span` (`[first, end)`, the raw lines of the Status section),
 * `outside` is whether every raw line outside it, before and after, is the same byte for byte, none trimmed (PMK-321); without it, `outside` is undefined.
 */
export function writeShape(before, after, span) {
  const [beforeLines, afterLines] = [before.split('\n'), after.split('\n')]
  const [from, to, at] = middle(beforeLines, afterLines)
  const [rewritten, written] = middle(lines(before), lines(after))
  const shape = { removed: removedLines(before, after), inPlace: from.length === 1 && to.length === 1 && readsAsStatus(from[0].trim()), at, oldLine: from[0], newLine: to[0], rewritten, written }
  if (span) {
    const tail = beforeLines.length - span[1]
    shape.outside = afterLines.length >= span[0] + tail && beforeLines.every((line, i) => (i >= span[0] && i < span[1]) || line === afterLines[i < span[0] ? i : afterLines.length - beforeLines.length + i])
  }
  return shape
}

/**
 * What the head's write does against the base's, for one body. `base` and `head` are `{ refused: true }`, `{ threw: <message> }` or a write: for the head the shape of `writeShape`, for the base at least its `removed`.
 * `section` is the trimmed non-blank lines of the Status section as CommonMark reads it, not as the head does, and `span` its raw lines of the text, `[first, end)`. `outcome` is one of `refusedBoth`, `newlyRefused`
 * (the base wrote, the head refuses), `acceptedWhereRefused` (the head writes and only replaces what it should), `same`, `headThrew`, `baseThrew` (an exception, with its `error`), or `worse`: the head
 * replaces a line in place that is not a known status or is outside the section, writes more than the one new status line (a duplicated, reordered or moved line), replaces only part of the section by one line, or removes text the base kept or refused (`extra` is that text).
 * Only two writes of the head are not worse by themselves: one known status line replaced in place inside the section, and the whole section replaced by one line, as the base does or refuses (PMK-311).
 * PMK-321: both are worse when they are not exactly that. The in-place line has to be `expectedLine` (its indent, `status`, its hard line break), and every raw line outside the section has to be the same (`outside`).
 * `status` is the text the command was asked to write.
 */
export function compareWrites({ base, head, section, span, status }) {
  // A guard or `setAdrStatus` that throws is a bug, not a refusal (the guards are what refuse): its own outcome, and it fails the run when it is the head's.
  if (head.threw !== undefined) return { outcome: 'headThrew', extra: [], error: head.threw }
  if (base.threw !== undefined) return { outcome: 'baseThrew', extra: [], error: base.threw }
  if (head.refused) return { outcome: base.refused ? 'refusedBoth' : 'newlyRefused', extra: [] }
  // An in-place write replaces a line of the section, by position: the same text may be outside it (PMK-318 review).
  if (head.inPlace && (head.at < span[0] || head.at >= span[1])) return { outcome: 'worse', extra: head.rewritten, written: head.written }
  // A section of one line is replaced whole (PMK-311, the base does the same): the status alone, no indent and no hard line break. The output equals an in-place write, so it is accepted as one for a one-line section.
  // Nothing is lost: CommonMark drops a hard line break at the end of a paragraph, an indent of up to 3 columns changes nothing, and at 4 the line was code that the write turns into text. A section of 2 or more lines gets the strict rule.
  if (head.inPlace && head.newLine !== expectedLine(head.oldLine, status) && !(section.length === 1 && head.newLine === status)) return { outcome: 'worse', extra: head.rewritten, written: [head.newLine], reason: 'new line' }
  if (!head.inPlace && head.outside !== true) return { outcome: 'worse', extra: head.rewritten, written: head.written, reason: 'outside the section' }
  // Any other write is a whole-section write: one new line for the whole section, not a part of it.
  const whole = head.written.length === 1 && head.rewritten.length === section.length && head.rewritten.every((line, i) => line === section[i])
  if (!head.inPlace && !whole) return { outcome: 'worse', extra: head.rewritten, written: head.written }
  // The one line of a one-line section is the status, whatever it says: replacing it whole is not a loss.
  const only = !head.inPlace && section.length === 1 ? head.rewritten : []
  const extra = head.inPlace ? [] : minus(minus(head.removed, base.refused ? [] : base.removed), only)
  if (extra.length > 0) return { outcome: 'worse', extra, written: head.written }
  return { outcome: base.refused ? 'acceptedWhereRefused' : 'same', extra }
}

// The corpus of adr-commonmark-diff.mjs (moved here by PMK-324 so `npm test` can read it). A case is the body of `## Status\n\n<body>\n## Context\n` (`textOf`).
export const textOf = (body) => `## Status\n\n${body}\n## Context\n`

// The cases: each cycle of the PR #241 review and the issue, every pair of lines, then random runs of lines.
const FIXED = [
  '- x\n\n1. a\n\n  b\n---', '- a\n\n```\nz\n```\n  b\n---', '- a\nlazy\n\n  b\n---',
  '- a\n-\n\n  x\n---', '-     a\nlazy\n\n  x\n---', '-     a\nz\n\n  x\n---', '-     a\n-\n\n  x\n---',
  '- a\n\n      code\nmore\n---', '- a\n\n  ```\n  z\n  ```\n```\ny\n```\n  b\n---', '- a\n  > q\nlazy\n\n  b\n---',
  '- a\nlazy\n\n\n      x\nlazy\n---', '-\n  x\n\n      x\nlazy\n---', '-\n      code\n\n  x\n---', '- a\n\n  > q\nlazy\n\n  c\n---',
  '- a\n    - m\n\n      c\nlazy\n---', '\n -\n      1) b\n\n      3)      b\na\n---', '\n   1. x\nlazy\n\n        3) \na\n  \tlazy\n   ===',
  '2.    lazy\n      a\n     b\nx\n\n        1.      a\nc d\n  + \n--',
  '-\n<!-- x -->\n---', '* \n<!-- x -->\n ---', '-\n[a]: /u\n ---', '> ###\n[a]: /u "t"\n ---', '1. ```\n[a]: /u\n-', '-\n</div>\n---', '<pre>\n\t~~~\n-',
  '<!--\n```\n-->\nAccepted\n',
]
const ITEMS = ['- a', '* a', '+ a', '1. a', '1) a', '2. a', '10) a', '-', '*', '1.', '2)', '-     a', '1.      a', '-\ta', '1.\ta', '- \ta', '\t- a',
  ' - a', '  - b', '   - b', '    - b', '     - c', '      - c', '  1) b', '   1. b', '    2. b', '- - a', '1. - a', '- 1) a', '-  a', '- * a', '  -', '    -']
const TEXT = ['a', 'lazy', ' x', '  x', '   x', '    x', '     x', '      x', '        x', '\tx', '\t\tx', ' \tx', '  \tx', '\t  x', '  # h']
const QUOTES = ['> q', '  > q', '>', '> - a', '- > q', '  - > q', '  > - q', '>     x', '>\tx', '    > q']
const FENCES = ['```', '~~~', '  ```', '   ~~~', '    ```', '````', '```x', '``` `', '      ```', '\t```', '~~~~', '  ~~~']
const BLANKS = ['', '', '  ', '\t']
const BREAKS = ['***', '* * *', '- - -', '___', '# h', '  ---']
// HTML blocks of the seven kinds, inline tags that are not blocks, and link reference definitions, whole or spread over lines.
const HTML = ['<!-- x -->', '<!-- c', '-->', '<div>', '</div>', '<div class="a">', '  <p>', '<pre>', '</pre>', '<script>', '</script>', '<x-y>', '</x-y>',
  '<a href="u">', '<span>x</span>', '<em>', '<![CDATA[', ']]>', '<!DOCTYPE html>', '<?php', '?>', '<x-y a=1 b="2"/>', '    <div>', '<div>x</div>']
const DEFS = ['[a]: /u', '[a]: /u "t"', "[b]: <u> 't'", '[a]: /u (t)', '[a]:', '/u', '"t"', '[a]: /u "t" x', '[ ]: /u', '[a]: /u\t', '[a]', ': /u', '  [a]: /u', '[a]: (u)']
const UNDERLINES = ['---', '===', '--', '-', ' ---', '   ===', '----  ']
// PMK-315: the lines that make the status line choice matter: known status words with and without emphasis, a date, `Supersedes`, `Key: value`, and a status with its own date.
const STATUS_WORDS = ['Accepted', 'accepted', '**Accepted**', '*Proposed*', '_Deprecated_', 'Proposed', 'Rejected', 'Draft', 'Superseded by ADR 2', '**Superseded by ADR 2**', 'Superseded by [ADR 2](0002-x.md)', '  Accepted', '    Accepted']
const STATUS_OTHER = ['Date: 2024-01-02', '2024-01-02', '- Date: 2024-01-02', 'Supersedes ADR 1', 'Supersedes: ADR 1', '**Supersedes** ADR 1', 'Status: Accepted', 'Deciders: a, b', 'Key: value', 'Accepted Date: 2024-01-02', 'Proposed by a']
const STATUSY = [...STATUS_WORDS, ...STATUS_OTHER]
const ALPHABET = [...ITEMS, ...TEXT, ...QUOTES, ...FENCES, ...BLANKS, ...BREAKS, ...HTML, ...DEFS]
// The weights of each kind in a random run: lists and text most, so nesting and lazy lines meet often. COMPOSED builds a line from parts.
const COMPOSED = []
const KINDS = [[ITEMS, 20], [TEXT, 18], [COMPOSED, 20], [BLANKS, 15], [QUOTES, 8], [FENCES, 9], [BREAKS, 3], [HTML, 10], [DEFS, 10]]
// Parts of a composed line: an indent of 0 to 8 columns with tabs, up to two quote or list markers each with a gap of 0 to 6 columns, then content.
const INDENTS = ['', ' ', '  ', '   ', '    ', '     ', '      ', '        ', '\t', ' \t', '  \t', '\t ', '\t\t']
const MARKERS = ['-', '*', '+', '1.', '1)', '2.', '3)', '10.', '>']
const GAPS = ['', ' ', '  ', '   ', '    ', '     ', '      ', '\t', ' \t']
const CONTENTS = ['a', 'lazy', '', '```', '~~~', '---', '# h', 'x y', '<!-- x -->', '<div>', '<pre>', '<x-y>', '[a]: /u', '[a]: /u "t"']

// Each case is a body, or `{ text, end }` with its own text and the way its block ends (`end` tallies the outcomes apart, PMK-321).
const CONTAINERS = []
for (const status of ['Accepted', '  Accepted  ']) for (const gap of [[], ['']]) {
  for (const open of ['> ```', '- ```', '> <div>', '- <div>']) {
    const inside = [open, open.startsWith('>') ? '> ## X' : '  ## X']
    const ends = { 'later line': ['', 'Date: 2024-01-02'], blank: [''], 'ATX heading': ['## Y'], 'setext heading': ['Title', '---'], 'end of file': [] }
    for (const [end, tail] of Object.entries(ends)) {
      const own = end === 'setext heading' || end === 'end of file'
      const body = [status, ...gap, ...inside, ...tail].join('\n')
      CONTAINERS.push({ text: own ? `## Status\n\n${body}\n` : textOf(body), end })
    }
  }
}

/** Mulberry32: the random numbers of the runs, from `seed`. */
const prng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
/** One random run: 1 to `lines` lines drawn from `kinds` by weight (COMPOSED builds a line from parts), then an underline with the chance `underline`. */
function randomRun(random, kinds, lines, underline) {
  const pick = (list) => list[Math.floor(random() * list.length)]
  const weight = kinds.reduce((sum, [, w]) => sum + w, 0)
  const run = []
  const count = 1 + Math.floor(random() * lines)
  for (let i = 0; i < count; i++) {
    let roll = random() * weight
    const [kind] = kinds.find(([, w]) => (roll -= w) < 0)
    if (kind !== COMPOSED) run.push(pick(kind))
    else {
      let line = pick(INDENTS)
      for (let m = Math.floor(random() * 3); m > 0; m--) line += pick(MARKERS) + pick(GAPS)
      run.push(line + pick(CONTENTS))
    }
  }
  if (random() < underline) run.push(pick(UNDERLINES))
  return run.join('\n')
}
const STATUS_KINDS = [[STATUSY, 35], [BLANKS, 15], [ITEMS, 8], [TEXT, 6], [COMPOSED, 6], [QUOTES, 4], [FENCES, 4], [HTML, 6], [DEFS, 3], [BREAKS, 3]]

// PMK-324: status lines ending in a hard line break or a near miss: two or three spaces, one backslash (a break), two (not a break) and three (a break). The cases below are only the combinations
// of the PMK-315 status cases with one of them in a status place (the others are already in the corpus), after all the older cases, so those stay the same and in order.
export const STATUS_BREAKS = ['Accepted  ', '**Accepted**   ', '  Proposed  ', 'Accepted\\', '**Superseded by ADR 2**\\', '  Proposed\\', 'Accepted\\\\', '_Deprecated_\\\\', 'Accepted\\\\\\']
const STATUS_ALL = [...STATUSY, ...STATUS_BREAKS]
const isBreak = (line) => STATUS_BREAKS.includes(line)
export function* breakPairs() {
  for (const b of STATUS_BREAKS) for (const a of [...STATUS_ALL, ...ALPHABET]) for (const u of UNDERLINES) yield `${b}\n${a}\n${u}`
  for (const a of ALPHABET) for (const b of STATUS_BREAKS) for (const u of UNDERLINES) yield `${a}\n${b}\n${u}`
}
export function* breakTriples() {
  for (const s of STATUS_ALL) for (const t of STATUS_ALL) if (isBreak(s) || isBreak(t)) for (const a of [...STATUS_ALL, ...ALPHABET]) for (const u of UNDERLINES) yield `${s}\n${t}\n${a}\n${u}`
  for (const s of STATUS_ALL) for (const a of ALPHABET) for (const t of STATUS_ALL) if (isBreak(s) || isBreak(t)) for (const u of UNDERLINES) yield `${s}\n${a}\n${t}\n${u}`
}
/** `count` random status runs like the PMK-315 ones, their status lines drawn from STATUS_ALL, with their own seed. */
export function* breakRuns({ seed, count, lines }) {
  const random = prng((seed + 2) >>> 0)
  const kinds = STATUS_KINDS.map(([kind, w]) => [kind === STATUSY ? STATUS_ALL : kind, w])
  for (let n = 0; n < count; n++) yield randomRun(random, kinds, lines, 0.3)
}

/**
 * The whole corpus, in order: each cycle of the PR #241 review and the issue, every pair and triple of lines, `random` random runs (seed `seed`, 1 to `lines` lines), the PMK-315 status pairs, triples and
 * `statusRandom` runs (seed `seed + 1`), the PMK-321 container cases, then the PMK-324 hard-break pairs, triples and `breakRandom` runs (seed `seed + 2`). A case is a body or `{ text, end }`.
 */
export function* cases({ seed, random: runs, statusRandom, breakRandom, lines }) {
  yield* FIXED
  for (const a of ALPHABET) for (const u of UNDERLINES) yield `${a}\n${u}`
  for (const a of ALPHABET) for (const b of ALPHABET) for (const u of UNDERLINES) yield `${a}\n${b}\n${u}`
  let random = prng(seed >>> 0)
  for (let n = 0; n < runs; n++) yield randomRun(random, KINDS, lines, 0.9)
  // PMK-315: bodies with status words. Pairs and triples with a status line in them, then random runs weighted to status lines, blanks between them and a few other blocks.
  for (const s of STATUSY) for (const a of [...STATUSY, ...ALPHABET]) for (const u of UNDERLINES) yield `${s}\n${a}\n${u}`
  for (const a of ALPHABET) for (const s of STATUSY) for (const u of UNDERLINES) yield `${a}\n${s}\n${u}`
  for (const s of STATUSY) for (const t of STATUSY) for (const a of [...STATUSY, ...ALPHABET]) for (const u of UNDERLINES) yield `${s}\n${t}\n${a}\n${u}`
  for (const s of STATUSY) for (const a of ALPHABET) for (const t of STATUSY) for (const u of UNDERLINES) yield `${s}\n${a}\n${t}\n${u}`
  random = prng((seed + 1) >>> 0)
  for (let n = 0; n < statusRandom; n++) yield randomRun(random, STATUS_KINDS, lines, 0.3)
  // PMK-321: the in-place write past a block that a quote or list item holds and closes (PMK-317). A status on a plain line, a fence or an HTML block in a quote or list item with a heading-like line in it, then the end of the block
  // by a later line, a blank line, an ATX heading, a setext heading or the end of the file. The last two have their own end, so the text is not the default `## Status ... ## Context` one.
  yield* CONTAINERS
  yield* breakPairs()
  yield* breakTriples()
  yield* breakRuns({ seed, count: breakRandom, lines })
}
