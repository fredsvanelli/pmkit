# PMK-310: name the right lines in the adr-status refusal

## Intent
PMK-306 refuses `docs adr-status` when the `## Status` section holds more than the status. The refusal is right but names wrong lines in three cases. Only the naming changes.

## Goals
- The opener of an HTML block or a fence that a guard (`adrHtmlHeld`, `adrFenceHeld`) names is named once, with its block, not again as other text.
- The status line is the one a reader takes as the status: a code span (`` `Accepted` ``) is not a fence, and a lazy line right after a list item or quote continues that item, so the item is the status and the lazy line is the text to move.
- The PMK-306 spec and plan say `adrStatusDropped`.

## Non-goals
- What is refused. Any section with two or more non-blank lines is refused today and stays refused (only which line counts as the status moves); a section with one line writes as before. `adrInfo` and the guards are untouched (`scripts/dev/adr-commonmark-diff.mjs` before and after).
- Keeping the other text (PMK-311).

## Approaches
1. Change `adrStatusDropped` to drop the openers. Rejected: it is documented as "what the write deletes", and its tests pin that list.
2. (Chosen) `statusLineOf` reads the trimmed lines with blanks, so adjacency is known; `OPENS_BLOCK` matches only a real fence opener (3+ backticks without a backtick after, or 3+ tildes); `runAdrStatus` removes the opener once next to the guard lines it already removes.

## Left to the builder
The closing line of a closed fence is still named as other text; out of scope, a follow-up candidate.
