# PMK-322: name the status the reader sees, and each fence apart, in the adr-status refusal

## Intent
`docs adr-status` refuses a `## Status` section it would have to replace whole and names the status (left out) and the other text to delete. Three cases still name the wrong lines; nothing refused, written or read changes:
1. A first line that is not paragraph text but reads as a status: `    Accepted` (indented code) or `[Accepted]: /u` (a link reference definition), then `> Proposed`. `statusLineOf` keeps the first line because `readsAsStatus(raw[first])` short-circuits, so `> Proposed` is named as text to delete.
2. A lazy continuation line: `Date: x`, blank, `> see ADR 3`, `Accepted`. The later-line search (`text` + `!inBlock()`) takes `Accepted` as a line of its own, though CommonMark reads it as part of the quote's paragraph.
3. Two fences with the same opener: the refusal says `the code fences "```", "```" take "## X", "## Y"` (which takes which?), and the `adr-get` note says `the code fence "```" takes "## X", "## Y"` (one fence).

## Approach
### `statusLineOf` (`scripts/lib/adr.mjs`)
One predicate for "a line of paragraph text", used for the first line and for the later candidate:

```js
const paragraph = (i) => /^ {0,3}\S/.test(orig[i]) && !NOT_TEXT.test(raw[i]) && (i === first || !inBlock().has(i))
const text = (item, i) => i > first && paragraph(i) && (OPENS_BLOCK.test(item) ? hostsLazy(item) : !KEY_VALUE.test(item)) && !ONE_LINE_COMMENT.test(item) && readsAsStatus(item)
const later = readsAsStatus(raw[first]) && paragraph(first) ? -1 : raw.findIndex(text)
```
- Indented code and a link reference definition: the tests the later line already had (`/^ {0,3}\S/`, `NOT_TEXT`, the same ones `topLevelStatus` uses for writing) now also gate the first line's short-circuit. A first line that fails them is not the status when a later line reads as one; with no such line the choice stays the first line (unchanged).
- Lazy continuation lines: `inBlock()` (one walk, lazy, as since PMK-316) also returns the lines the block walk (`sectionEnd`) appends to an open paragraph lazily (its existing lazy branch, `!allClosed && !blank && open.at(-1).type === 'paragraph'`). They go in a new `held.lazy` list, so `held` entries and their readers (`headingLike`, the guards) are untouched. No second way of deciding block kind: the walk already makes that decision.
- The first line of the section can never be lazy or held by a block, so `paragraph(first)` skips the walk: the common path costs no extra walk.
- Out of scope, unchanged: a later line glued to the first line's paragraph (`Date: x` / `Accepted`) is an ordinary continuation, not lazy, so it is still chosen; `KEY_VALUE` stays out of the first-line test (`Superseded by: ...` is a status).

### Fence names (`scripts/lib/adr.mjs`, `scripts/pmkit.mjs`)
- `adrFenceBlocks` returns `lines` per fence too (grouped by block with a `Map`, linear).
- Refusal (`runAdrStatus`): one cause per fence, `"## X", which the code fence "```" takes into the Status section; and "## Y", which the code fence "```" takes into the Status section`. The fix step is said once (causes' fixes deduplicated). With one fence the text is identical to today.
- `adr-get` note: `the code fence "```" takes "## X" and the code fence "```" takes "## Y" into the Status section, ...`, built from `adrFenceBlocks`; one fence reads as today. The JSON `fenceHeld` field keeps its shape.

## Tests that change on purpose
- `scripts/adr.test.mjs` "the refusal names two fences with the same opening line after ... as N fences (PMK-319)": it asserts the plural `the code fences "```", "```" take`. It now asserts each fence named with its own line (`"## X", which the code fence "```" takes`, same for `## Y`, `## Z`), the reason being the wording this issue replaces.
- Any golden or CLI test that pins the plural wording, if the run shows one.

## New tests (failing first)
- Refusal, dry run and real: `    Accepted` / `[Accepted]: /u`, blank, `> Proposed` names `"Accepted"` / `"[Accepted]: /u"` as text and not `"> Proposed"`; `Date: x`, blank, `> see ADR 3`, `Accepted` names `"> see ADR 3"`, `"Accepted"` and not `"Date: x"`; the same for a list item lazy line; file unchanged.
- Two fences with the same opener: refusal and `adr-get` note name each fence with its line.

## How the acceptance criteria are shown
1. The tests above (`adrStatusDropped` and the CLI, dry run and real).
2. The changed PMK-319 test and an `adr-get` note test.
3. A develop x branch comparison (script in the session scratchpad, not in the repo) on 150,000 random Status bodies with a seed: refused yes/no, `nextStep`, notes other than the fence note, text written and `adr-get` status equal; every message difference classified as case 1, 2 or 3, 0 unexplained; time on develop vs branch. `scripts/dev/adr-commonmark-diff.mjs` run as a cross-check.

## Complexity
One extra linear walk at most per `statusSection` call, only when the first line does not settle it (as today). Grouping fence lines is one pass. A probe test (20,000 lazy lines after a quote) joins the PMK-319 probe.
