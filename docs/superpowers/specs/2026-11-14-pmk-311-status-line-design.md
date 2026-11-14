# PMK-311: adr-status keeps the other lines of the Status section

## Intent
PMK-306 refused when the `## Status` section holds text besides the status, because `adr-get` read the whole section as the status. This reverses that for lines like a MADR date or a Nygard `Supersedes`, so `record-decision` can mark the older ADRs. Decision recorded in ADR 0006.

## Goals
- `adr-get` reads one line as the status; `adr-status` replaces that line and keeps the rest, real and dry run.
- A one-line section reads and writes as before.
- HTML block and fence guards still refuse when a block takes a heading into the section.

## Non-goals
- Front matter `status:` and the `Status:` line above the first section. Rewriting the other text. The PMK-310 follow-ups (closing of a closed fence, loose dedup prefix regex, nested marker).

## Approaches
1. First paragraph as status. Rejected: MADR `Accepted` and `Date:` are adjacent lines, one paragraph.
2. One top-level paragraph line (chosen, review cycle 1): `topLevelStatus`, see Design. The first version took `statusLineOf` (PMK-310) and wrote inside comments, fences and code, or took a date for the status.
3. Keep refusing. Rejected: the issue.

## Design
- `topLevelStatus(lines)` (adr.mjs): the status line is the first non-blank line of the section after blanks and one-line comments, when it is indented under 4 columns, does not open a block (`OPENS_BLOCK`), is not a link reference definition or thematic break, is not `Key: value` or `Supersedes ...`, and reads as a known status (review cycle 2): with leading emphasis and punctuation removed, its first word (`\p{L}+`) is in `ADR_STATUSES` or is `proposed`, `rejected` or `draft`, any case; else none; and none too when another line of the section also reads as a known status (ambiguous, review cycle 3). Dates (`**Date:** x`, `2024-01-02`) and unknown words are never replaced, so exclusions by regex are no longer the safety net. It applies only when the section has more than one non-blank line.
- `adrInfo`: the section part of `statuses` is that line; with none (or one non-blank line) it is the section joined, as before PMK-311. A status broken over two lines is read as its first line only.
- `setAdrStatus`: with a top-level status line, replace only it (indent kept), the rest of the section untouched; `before` is that line. Otherwise as before PMK-311 (a one-line section is rewritten as `''`, status, `''`).
- `adrStatusDropped`: `[]` for one line or a top-level status line; otherwise the lines the old write deleted (as in PMK-306 and PMK-310), so a multi-line section with no such line is refused as before PMK-311. Its next step (`OTHER_TEXT_FIX`) says to put the status on a plain line of its own at the top; other lines may follow.
- Nothing that was written before PMK-311 is refused now: a one-line section (`- Accepted` alone) writes as before.
- A plain line glued under the status (not `Key: value`) is kept and noted in the dry run: it may be the rest of a status broken over two lines (read as the first line only, ADR 0006).
- Guards: `adrHtmlHeld` and `adrFenceHeld` unchanged and still refuse when a block takes a heading into the section.
- `--by N`: `adr-status` writes only `Superseded by <path>` as the status and never a `Supersedes` line (the new ADR has it), so nothing is duplicated. A kept line that already cites ADR N (`ADR N` or the file name) adds a note.
- adr-commonmark-diff compares `adrSectionText` (the whole section) with CommonMark and counts how `adrInfo` reads it.
- Docs: record-decision step 7 and its scenario/golden, adr-status.md, README, CHANGELOG.
