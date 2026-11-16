# PMK-314: keep a hard line break and skip guards that delete nothing in the in-place adr-status write

## Intent
Since PMK-311 `docs adr-status` replaces only the status line of a multi-line `## Status` section when it has a top-level status line (`safe` of `statusSection`) and keeps every other line. Three behaviours still assume the whole section is replaced: the HTML block and fence guards (and the matching `adr-get` notes), the loss of a trailing hard line break, and the continuation note for thematic breaks.

## Goals
- `adrHtmlHeld`, `adrFenceHeld` and `adrFenceClosers` return nothing when `safe !== -1`. They guard what a write deletes, and the in-place write deletes nothing. Exception, forced by the existing tests (PMK-299, PMK-302 results unchanged): a block that never closes (an unclosed `<!--` or fence, or a fence a quote or item closes) is still named, since it swallows the headings after it. So in place only closed fences and HTML blocks that end normally (a comment with its `-->`, a `<div>` ended by a blank line, my call: the section end is right) are skipped. `adr-get` shares them, so it stops noting the held heading too. The refusal loop in `runAdrStatus` needs no change: `adrStatusDropped` is already `[]` for `safe !== -1`. When the whole section is replaced (no known status line, status in an item or quote, ambiguous section, one status line) the guards run as before, closed or not. Includes the repro after PMK-313's next step: a status on its own line, then a closed fence holding `## X`.
- A trailing hard line break on the status line (two or more spaces, or one backslash; an even run of backslashes is an escaped backslash, not a break) is kept by the in-place write. `adr-get` reads the status without it (`Accepted\` reads `Accepted`), and the "unchanged" test compares without it. `KNOWN_STATUS` already reads `Accepted\` as known (it takes the first word).
- A one-line section with a break at the end reads without the break and is written whole, as before (nothing follows, so a break has no meaning there).
- `adrStatusContinuation` does not fire for `***` or `___` (`THEMATIC`, as `NOT_TEXT` has it). `---` glued under the status is a setext underline, so the section is empty there and the note never runs (PMK-294); `- - -` and `* * *` are already `OPENS_BLOCK`.

## Non-goals
Which line is the status; what is refused when the whole section is replaced; the refusal text of the list item and quote cases; `sectionEnd`.

## Approaches
1. Guard in `runAdrStatus`: skip the guards when `adrKeptLines` is not empty. Rejected: `adr-get` also calls the guards, so it would need the same check twice, and the next reader of `adrHtmlHeld` gets a wrong answer.
2. (Chosen) Decide inside the guards with `statusSection(...).safe`, the one source that read and write already share.
3. Break: a regex on the written line only. Rejected: `adrInfo` must read the same line, so `statusSection` returns the break and the break-free text.

## Proof
develop x branch on random Status bodies (refusal, written text, `adr-get` read and notes): divergences only for the cases above. `node scripts/dev/adr-commonmark-diff.mjs` before and after: 0 worse.
