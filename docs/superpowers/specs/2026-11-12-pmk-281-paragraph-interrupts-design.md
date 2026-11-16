# PMK-281: match CommonMark on which lines interrupt the Status paragraph

## Problem

`locate().end` (`scripts/lib/adr.mjs`) walks back from a setext underline to the start of its paragraph. Three of its tests differ from CommonMark:

1. `INTERRUPTS_PARAGRAPH` accepts `2. foo` and an empty item (`-`, `*`, `1.`). CommonMark: an ordered item interrupts a paragraph only when it starts at 1, and an empty item never interrupts one. `Accepted\n2. foo\n===` must end the section at `Accepted`.
2. `NOT_PARAGRAPH_START` (`^( {4}|\t)`) rejects the whole walk when the first line of the run is indented, so `Accepted\n\n\tcode\nmore\n===` keeps the section open. CommonMark: the indented line is code (it follows a blank line), the code block ends at `more`, and `more` + `===` is a setext heading, so the section ends at `more`. Inside a paragraph (`Accepted\n\tcode\nmore\n===`) a tab line is a continuation. A tab counts up to the next 4-column stop.
3. From the PMK-280 review, same regexes: `- - -` / `* * *` is a thematic break and `LIST_ITEM` takes it for an item; the comment of `LIST_ITEM` sits under the wrong constant.

## Design (decided without questions: the coordinator opted out)

- Two list-start tests. The narrow one (`INTERRUPTS_PARAGRAPH`: quote, bullet with content, ordered `0*1` with content) decides what interrupts a paragraph in the walk. The wide one (`BLOCK_START`: the old regex) decides what a line that starts a block (after a blank line, a heading or a break) is: `Accepted\n\n2. foo\n===` and `Accepted\n\n-\n===` are still lists, so the section stays open.
- `indentColumns(line)` counts leading columns with tab stops. When the walk stops on a line with 4 or more columns, that line starts an indented code block: skip the code lines and let the paragraph start at the first less indented line; with none before the underline there is no heading.
- `LIST_ITEM` is not a thematic break. Reuses `THEMATIC_BREAK`, `headingLevel` and the one parser of PMK-263.

## Non-goals

Tables, HTML blocks, a full list parser, an indented or closed Status heading (PMK-282), the setext test in `adr-status` (PMK-283). The other PMK-280 review findings stay follow-ups: a sibling item that is too wide keeping the section open, a code fence at indent 0 ignored in the walk back, and a lazy continuation before the blank line.

## Tests

`adrInfo` and `setAdrStatus` on each case, plus `docs adr-get` and `docs adr-status` through the CLI; PMK-263, 268, 269, 270, 273, 280 tests must keep passing.
