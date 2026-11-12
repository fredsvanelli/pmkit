# PMK-291: follow list nesting when a line continues a list item before an underline

`locate().end` (`scripts/lib/adr.mjs`) asks `continuesItem(top)` whether the first line of the paragraph above a setext underline sits inside a list item (then `---` is a thematic break, not a heading). It walks back and lets the nearest item whose content column fits decide. Three texts end the Status section in the wrong place:

1. Wider sibling: `- x\n\n1. a\n\n  b\n---`. `1. a` closes `- x` and `b` (column 2) is outside `1. a` (content at 3): `b` is a paragraph, `---` a heading.
2. Fence at column 0: `- a\n\n```\nz\n```\n  b\n---`. The fence ends the list; `b` is a paragraph.
3. Lazy continuation: `- a\nlazy\n\n  b\n---`. `lazy` belongs to `- a`, so `b` is inside the item and `---` is a thematic break.

## Design (my call, no new parser)

Replace the walk back by a forward walk from the section start to `top` that keeps a stack of the content columns of the open items (`itemContent`, `indentColumns`, columns with tabs to stops of 4):

- A blank line is skipped.
- A line indented less than the top content column closes that item, unless it is a lazy continuation: it follows a paragraph line directly and starts no block (not a list item that interrupts a paragraph, a quote, a fence or a thematic break).
- A list item pushes its content column. A fence opening line closes items like any block line; fence interior lines are skipped.
- A line of 4 or more columns past the top content column after a blank line is indented code: skipped.
- `top` continues an item when, after closing the items it is not indented into, one is still open.

Out of scope: a full list parser (quotes inside items, `1.` numbering, setext inside items).

## Check

Compare `adrInfo` of develop and the branch over a generated set of list cases against commonmark.js as oracle. No case may get worse. Tests: one per text, in `scripts/adr.test.mjs`, plus `setAdrStatus`/`adr-get`/`adr-status` paths share `locate`.

## Cycle 4 (after three review cycles)

Each patch of `continuesItem` broke a new form (empty item, marker with 5+ spaces, code inside an item, item nested 4+ columns in). The rule now follows CommonMark's block structure instead: `sectionEnd(lines, from)` walks forward from the section start with a stack of open blocks (quote, list item with its content column, paragraph, indented code, fence). Each line continues the open blocks in order, starts blocks in the deepest one it continued, or is a lazy line of the open paragraph. The section ends at the first ATX or setext heading whose parent is the document. Still no inlines, HTML blocks or link reference definitions.

Check: `scripts/dev/adr-commonmark-diff.mjs --commonmark <dir>` (commonmark.js 0.31.2 installed outside the repository) compares develop and HEAD against the oracle; the PR is pushed only with 0 cases worse than develop.
