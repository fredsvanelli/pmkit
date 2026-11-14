# PMK-317: write in place past a fence closed by the end of its quote or list item (design)

Small change (estimate 2). Only `scripts/lib/adr.mjs` (`sectionEnd`, `fenceRisk`), its tests, `commands/spec/adr-status.md`, the CHANGELOG and, if the reading contract changes, ADR 0006.

## Why
Since PMK-314 a section with a top-level status line is written in place, so a fence that closes holds its lines and nothing is deleted. `fenceRisk` exempts only a fence with a closing line (`block.closer`). A fence closed by the end of the quote or list item that holds it has no closing line, so `Accepted`, blank, `> ```` `, `> ## X`, blank, `Date: 2024-01-02` (and the list item form) is refused and `adr-get` notes it, though CommonMark closes the fence there and the in-place write keeps every line.

## Goals
- On the in-place write, a fence that its container ends is exempt like one with a closing line: no refusal, no `adr-get` note, real and dry run.
- Nothing else changes: a fence still open at the end of the file, a fence whose container ends only at the heading that ends the section, whole-section replacement (no known status line, status in an item or quote, two statuses, a status after a block), and the HTML guard.

## Non-goals
- Which line is the status; the whole-section guard; the HTML guard (it already exempts a block its container closed, through `held.unclosed`, which is set only at the end of the file).

## How the end of the container is known
One walk finds it: `sectionEnd` already continues a quote by its `>` and an item by its indent, and a fence is a leaf, so a line that does not continue the fence's container drops it from the stack. There is no second parser. The walk records on the fence block that the container ended (`ended`) when a **non-blank line of the section** follows the point where the stack dropped the fence:

- A quote ends at the first line without `>` (a blank line included); a fence is not a paragraph, so a line without `>` is no lazy continuation. An item ends at the first non-blank line indented less than its content column; a blank line followed by an indented line continues the item and the fence stays open.
- `ended` is set when the walk then processes a non-blank line that is part of the section. The heading that ends the section returns before it counts, and so does the end of the file. So a fence open at the next top-level heading (`> ```` `, `> ## X`, blank, `## Context`, the case `scripts/adr.test.mjs` pins as refused since PMK-314) and one open at the end of the file keep refusing, and a container that ends before a line of the section (`Date: 2024-01-02`) is closed.

`fenceRisk` then exempts, in place, `closer !== undefined || ended`.

## Approaches
1. **Mark the block in `sectionEnd` when its container ends before a later line of the section** (chosen). One walk, one mechanism, same place the HTML guard gets `held.unclosed`; keeps the pinned heading case refusing.
2. Treat any fence that is not open at the end of the file as closed, as the HTML guard does. Simpler, but the early return at the heading makes `> ```` ` + blank + `## Context` write in place, and the existing PMK-314 test and the brief say it keeps refusing.
3. A second scan of the lines for `>` and indentation. Rejected: a second way to find the end of a container.

## Calls made (mine)
- "Still open at the next top-level heading" is read as the heading being the first non-blank line after the container ends. A quote or item that reaches the heading with only blank lines in between stays refused; this is the existing test, unchanged.
- The ADR 0006 reading contract does not change in kind: the `adr-get` note is the same note, shown for fewer texts. The spec page and the ADR are updated if they name the closed-by-closing-line rule.

## Proof
Develop against this branch on random Status section bodies (refusal, text written, `adr-get` reading), the divergences are only the cases of the issue and no new write removes a non-blank line other than the status line; `node scripts/dev/adr-commonmark-diff.mjs` in full before and after, 0 worse.
