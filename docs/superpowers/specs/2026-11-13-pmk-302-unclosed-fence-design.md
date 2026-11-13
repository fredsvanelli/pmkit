# PMK-302: refuse to delete what an unclosed code fence takes into the Status section

## Intent
`docs adr-status` deletes the text between `## Status` and the next heading. An unclosed fence (``` or ~~~) in that section runs to the end of the document by CommonMark, so a `## Context` after it is fence content, the section reads as extending to the end, and the write deletes it. PMK-299 refuses this for HTML blocks (`adrHtmlHeld`); a fence is the same case with another cause.

## Goals
- `adr-status` (dry run too) refuses with `INVALID_INPUT` and a next step (close the fence); nothing is written.
- `adr-get` names the cause in a note and a `fenceHeld` field.
- Reading (`adrInfo`, `sectionEnd` result) does not change.

## Non-goals / anti-goals
- No change in how the section is read. No refusal when there is nothing to lose: a fence that closes, or an unclosed one with no heading-looking line after its opener, writes as today.

## Approaches
1. Sibling of `adrHtmlHeld` (`adrFenceHeld`) fed by the same `sectionEnd` walk, which records the lines an open fence continues and the fence still open at the end of the file. Chosen: reuses the walk that already knows a fence closes only with the same character and at least the same length.
2. Extend `adrHtmlHeld`'s return shape. Rejected: its callers and message name an HTML block.
3. A second regex scan of the text. Rejected: would disagree with `sectionEnd` (nesting, 4-backtick fences).

## Design
- `sectionEnd` pushes `{ at, heading, block }` into `held` for each non-blank line an open fence continues (the `fence` block now has `first`, the opener line), and sets `held.unclosedFence` (the fence open at the end, else null). The existing HTML filter ignores fence entries.
- `adrFenceHeld(text)` returns `{ opener, lines }` (trimmed heading-looking lines the unclosed fence takes), else null.
- `pmkit.mjs`: `runAdrStatus` throws `INVALID_INPUT` after the HTML check; `runAdrGet` adds `fenceHeld` and a note.
- Heading-looking: `headingLevel(line) > 0` (ATX), as PMK-299.
