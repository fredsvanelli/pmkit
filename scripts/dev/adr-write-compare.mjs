// Pure helpers of adr-commonmark-diff.mjs (PMK-315), kept apart so `npm test` can run them without commonmark.

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)
/** The multiset difference `a` minus `b`, in the order of `a`. */
const minus = (a, b) => {
  const left = new Map()
  for (const item of b) left.set(item, (left.get(item) ?? 0) + 1)
  return a.filter((item) => !(left.get(item) > 0 && left.set(item, left.get(item) - 1)))
}

/** The trimmed non-blank lines of `before` that `after` no longer has, as a multiset. */
export const removedLines = (before, after) => minus(lines(before), lines(after))

/**
 * What the head's write does against the base's, for one body. `base` and `head` are `{ refused: true }` or `{ removed }` (see `removedLines`);
 * `headStatus` is the line the head replaces, which the write always removes and so is not extra. `outcome` is one of `refusedBoth`, `newlyRefused`
 * (the base wrote, the head refuses), `acceptedWhereRefused` (the head writes and removes only its status line), `same`, or `worse`: the head removes
 * text the base kept (both write) or refused (the base refuses), and `extra` is that text.
 */
export function compareWrites({ base, head, headStatus }) {
  if (head.refused) return { outcome: base.refused ? 'refusedBoth' : 'newlyRefused', extra: [] }
  const extra = minus(minus(head.removed, base.refused ? [] : base.removed), headStatus === '' ? [] : [headStatus])
  if (extra.length > 0) return { outcome: 'worse', extra }
  return { outcome: base.refused ? 'acceptedWhereRefused' : 'same', extra }
}
