# PMK-280: keep the Status section open past a list item continuation

## Problem

`locate().end` (`scripts/lib/adr.mjs`) ends a `## Status` section at a setext heading and walks back to the start of its paragraph. In `## Status\n\nAccepted\n\n- a\n\n  b\n---` the line `  b` is a continuation of the list item `- a`, and `---` is a thematic break. The walk takes `  b` for a setext paragraph, so the section ends at `  b`: `adr-get` loses `b` and `---`, and `adr-status` leaves them under the new status.

## Design (small change, decided without questions: the coordinator opted out)

CommonMark: a line indented to the content offset of a list item that is open above it belongs to that item, and a setext underline cannot be a lazy continuation. So after the walk finds the paragraph start `top`, `locate` checks whether `top` continues a list item; if so the underline is a thematic break and the section stays open.

`continuesListItem(top)`: `top` is indented by at least one space; scan back over earlier lines (skipping blanks and fenced lines) until a list item line whose content offset (indent + marker + spaces) is `<=` the indent of `top` (true), or a non-blank line with no indent (false). Reuses `INTERRUPTS_PARAGRAPH` style list marker test via a new `LIST_ITEM` regex that captures the content offset.

## Non-goals

No full list parser (nested item tracking, tabs, ordered-list width corner cases). Lines that interrupt the paragraph, an indented or closed Status heading and a setext test in `adr-status` belong to PMK-281 to PMK-283.

## Builder check (read by me, no subagent)

Open points settled: the `---` stays in the section (thematic break); a continuation line indented less than the item content (`- a\n\n b\n---`) is a paragraph, so the section ends there, as CommonMark says.

## Tests

`adrInfo` and `setAdrStatus` on the issue's text; the same through `docs adr-get` and `docs adr-status`; ordered item; multi-line continuation; less-indented line still ends the section.
