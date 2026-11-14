# PMK-313: name the extra text, not the status, in the adr-status refusal of a list item or quote

## Intent
When the status of a `## Status` section is a list item or a quote, `docs adr-status` refuses (as before PMK-311) but names the wrong lines: `statusLineOf` skips the item and takes a later plain line (a date, a `Supersedes` line) as the status, so the refusal names the status as text to delete. A nested item (`- - Accepted`) followed by a lazy line is named too, and the closing line of a closed fence the heading guard already names is named again as other text. Only the naming changes.

## Goals
- A first line that is an item or quote with text (nested markers included) is the status; every other line is the text to move. Leading one-line comments are skipped, as `topLevelStatus` does.
- The closing line of a fence that `adrFenceHeld` names goes with that fence, once, in a list and in a quote.

## Non-goals
- What is refused and what is written. `count > 1 && safe === -1` decides the refusal and is untouched; `statusLineOf` only picks which of the lines is called the status, so `adrStatusDropped` has the same length. Proved with a develop x branch comparison on random Status bodies.
- Writing a status in an item or quote in place; the HTML and fence guards of the in-place path, the forced line break and the continuation note (PMK-314). `sectionEnd` and the section extent (`node scripts/dev/adr-commonmark-diff.mjs` before and after: 0 worse).

## Approaches
1. Choose the status line from the block structure of `sectionEnd`. Rejected: its walk returns an end, not per-line block types, so this needs a second walk output for a rule that the first line decides.
2. (Chosen) Keep `statusLineOf` and make `hostsLazy` recursive over nested markers, plus a rule: the first non-blank, non-comment line that hosts text is the status, blank lines or not. Items whose content is a block (`- ```` `, `- # H`, `-`) keep the PMK-310 result.
3. Closing fence: `sectionEnd` records the line that closes a fence on its block (`closer`); `adrFenceClosers` returns the closers of the fences `adrFenceHeld` names; `runAdrStatus` removes each once from the other text.

## Left to the builder
Indentation is lost in `raw` (trimmed), as today; a 4-space indented `- x` is read as an item. Out of scope.
