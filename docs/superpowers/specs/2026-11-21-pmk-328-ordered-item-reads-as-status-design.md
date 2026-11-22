# PMK-328: read an ordered list item as a status, as a bullet item

## Problem

`readsAsStatus` (`scripts/lib/adr.mjs`) takes the first word of a trimmed line after skipping every character that is neither a letter nor a digit. A bullet marker (`- `) is skipped, so `- Proposed` reads as a status. The digits of an ordered list marker are not, so the first "word" of `1. Proposed` is never found and the line never reads as a status.

Every decision that asks `readsAsStatus` therefore treats `1. Proposed` as plain text:

- the in-place guard (`safe` in `statusSection`): `Accepted`, blank, `1. Proposed` is written in place, leaving a second status the reader sees (`<ol><li>Proposed</li></ol>`), while `- Proposed` makes the section ambiguous and refuses;
- the section read whole (`adrInfo`): with the guard open, `adr-get` reads `Accepted` instead of the section whole;
- the refusal's names (`statusLineOf`): `1. Accepted`, blank, `> Proposed` keeps `> Proposed` as the status and names `1. Accepted` as text.

Root cause: one regex, in one function every caller routes through. The fix goes there, and in its copy in `scripts/dev/adr-write-compare.mjs`, which mirrors the rule on purpose.

## Approaches

1. **Strip list and quote markers, ordered ones included, before the first-word rule** (chosen). One change in the one function every caller uses; the guard, the whole-section read and the names follow from it.
2. Special-case ordered items in each caller (`safe`, `statusLineOf`). Three places to keep in step, and a fourth in the dev copy; the next caller would miss it.
3. Widen the skip class to digits (`[^\p{L}]*`). Shortest, but `1.Accepted`, `2024 Accepted` and `**1. Accepted**` would read as a status too, which the issue keeps out of scope.

## Design

Before the existing first-word rule, strip the list and quote markers at the start of the line, ordered markers included:

```js
const LIST_MARKERS = /^(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*/
const readsAsStatus = (item) => KNOWN_STATUS.has(/^[^\p{L}\p{N}]*(\p{L}+)/u.exec(item.replace(LIST_MARKERS, ''))?.[1].toLowerCase() ?? '')
```

- An ordered marker is 1 to 9 digits, then `.` or `)`, then a space or tab (CommonMark). `10.`, `1)` and nested forms (`> 1. Proposed`, `- 1. Proposed`) read as a status when their text does.
- `1.Accepted` (no space) and `see 1. Proposed` (first word `see`) are untouched: the regex only strips a marker at the start, followed by a space or tab.
- `**1. Accepted**` and `(1) Accepted` are untouched: a marker is only stripped after spaces, `>` and bullet markers, so emphasis or a parenthesis before the digits stops the strip, as today.
- The strip never turns a line that read as a status into one that does not: it only removes characters the first-word rule already skips, plus the digits of an ordered marker, which today end the match with no word.

The same two lines replace the copy in `scripts/dev/adr-write-compare.mjs`, with its comment updated.

### What changes, by caller

- `statusSection.safe`: any other line that reads as a status makes the section ambiguous. An ordered item now does, so `Accepted`, blank, `1. Proposed` refuses with `would delete the other text of the Status section, "1. Proposed"`, as the bullet does, and `adrInfo` reads the section whole (`Accepted 1. Proposed`).
- `statusLineOf`: `1. Accepted`, blank, `> Proposed` keeps `1. Accepted` (its first item reads as a status) and names `> Proposed`.
- A glued `Accepted`, `2. Proposed` (no blank, so a lazy paragraph line in CommonMark, since only `1.` interrupts a paragraph) also refuses now: the guard refuses any other line that reads as a status, plain text included (`Accepted`, `Proposed` refuses today). This is the guard's rule, not new; the comparison will show these cases and the PR explains them.

## Tests (TDD, `scripts/adr.test.mjs`)

A table loop, bullet item as control in every row:

1. `Accepted`, blank, `X` for `X` in `1. Proposed`, `1) Proposed`, `10. Proposed`, `  1. Proposed`: refuses (dry run and real) naming `X` like `- Proposed`, file unchanged; `adrInfo` status equals the bullet one's with the marker swapped.
2. `1. Accepted`, blank, `> Proposed` (and `1)`, `10.`, indented): `adrStatusDropped` names `> Proposed` and not the item, as `- Accepted`.
3. Unchanged: `Accepted`, blank, `1.Accepted` and `Accepted`, blank, `see 1. Proposed` are written in place as on develop.

Plus a test in `scripts/dev/adr-write-compare.test.mjs` that the copy reads the ordered item cases the same way as the lib (through the CLI-visible behaviour is enough; the copy is tested directly).

## Evidence for the PR

- A develop x branch comparison on random Status bodies (a scratch script, not committed) of refusal, text written, `adr-get` status and names; every difference classified as coming from an ordered item that reads as a status.
- `scripts/dev/adr-commonmark-diff.mjs --base origin/develop --head worktree` full run: exit 0, 0 worse.

## Out of scope

`1.Accepted`, `see 1. Proposed`, any other change to the walk.

## Interview

Checked against the issue, `CONTEXT.md` and the ADRs (ADR 0006: the ADR status is one line of the Status section; a section with two statuses is read whole and refused).

- Does an ordered item change the ADR 0006 rule? No: it is one more line that reads as a status, so a section with it and another status is the two-status case ADR 0006 already refuses. No new ADR.
- Up to 9 digits or any number? 9, as CommonMark and the existing `OPENS_BLOCK` comment (PMK-292, a 9-digit marker is still a list item). `1234567890. Accepted` stays unread.
- A glued `2. Proposed` (a lazy line in CommonMark): refused, because the guard refuses any other line reading as a status, plain text included. Accepted as is; reported in the PR.
- New terms: none; `CONTEXT.md` unchanged.
- Approval: no open product question; the acceptance criteria settle the behaviour, so the design is approved under the owner's rule (pmkit PO, acceptance criteria as approval).
