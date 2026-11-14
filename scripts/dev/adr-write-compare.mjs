// Pure helpers of adr-commonmark-diff.mjs (PMK-315, PMK-318), kept apart so `npm test` can run them without commonmark.

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
 * `at` is the raw line of `before` that an in-place write replaced.
 */
export function writeShape(before, after) {
  const [from, to, at] = middle(before.split('\n'), after.split('\n'))
  const [rewritten, written] = middle(lines(before), lines(after))
  return { removed: removedLines(before, after), inPlace: from.length === 1 && to.length === 1 && readsAsStatus(from[0].trim()), at, rewritten, written }
}

/**
 * What the head's write does against the base's, for one body. `base` and `head` are `{ refused: true }`, `{ threw: <message> }` or a write: for the head the shape of `writeShape`, for the base at least its `removed`.
 * `section` is the trimmed non-blank lines of the Status section as CommonMark reads it, not as the head does, and `span` its raw lines of the text, `[first, end)`. `outcome` is one of `refusedBoth`, `newlyRefused`
 * (the base wrote, the head refuses), `acceptedWhereRefused` (the head writes and only replaces what it should), `same`, `headThrew`, `baseThrew` (an exception, with its `error`), or `worse`: the head
 * replaces a line in place that is not a known status or is outside the section, writes more than the one new status line (a duplicated, reordered or moved line), replaces only part of the section by one line, or removes text the base kept or refused (`extra` is that text).
 * Only two writes of the head are not worse by themselves: one known status line replaced in place inside the section, and the whole section replaced by one line, as the base does or refuses (PMK-311).
 */
export function compareWrites({ base, head, section, span }) {
  // A guard or `setAdrStatus` that throws is a bug, not a refusal (the guards are what refuse): its own outcome, and it fails the run when it is the head's.
  if (head.threw !== undefined) return { outcome: 'headThrew', extra: [], error: head.threw }
  if (base.threw !== undefined) return { outcome: 'baseThrew', extra: [], error: base.threw }
  if (head.refused) return { outcome: base.refused ? 'refusedBoth' : 'newlyRefused', extra: [] }
  // An in-place write replaces a line of the section, by position: the same text may be outside it (PMK-318 review).
  if (head.inPlace && (head.at < span[0] || head.at >= span[1])) return { outcome: 'worse', extra: head.rewritten, written: head.written }
  // Any other write is a whole-section write: one new line for the whole section, not a part of it.
  const whole = head.written.length === 1 && head.rewritten.length === section.length && head.rewritten.every((line, i) => line === section[i])
  if (!head.inPlace && !whole) return { outcome: 'worse', extra: head.rewritten, written: head.written }
  // The one line of a one-line section is the status, whatever it says: replacing it whole is not a loss.
  const status = !head.inPlace && section.length === 1 ? head.rewritten : []
  const extra = head.inPlace ? [] : minus(minus(head.removed, base.refused ? [] : base.removed), status)
  if (extra.length > 0) return { outcome: 'worse', extra, written: head.written }
  return { outcome: base.refused ? 'acceptedWhereRefused' : 'same', extra }
}
