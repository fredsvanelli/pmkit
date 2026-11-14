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
2. One line (chosen): `statusLineOf` (PMK-310): first non-blank line that does not open a block, else the first.
3. Keep refusing. Rejected: the issue.

## Design
- `adrInfo`: the section part of `statuses` is `statusLineOf(trimmed section lines)` (empty section: none). One line sections read as before; a wrapped status reads as its first line.
- `setAdrStatus`: in a section with exactly one non-blank line, write as before (`''`, status, `''`). With more, replace only the status line in place, other lines (and blanks) untouched; `before` is that line, not the joined section. Unchanged check compares that line.
- `adrStatusDropped` (`adrStatusDropped` of PMK-306) keeps a single remaining cause: a section whose lines all open a block (no plain line) and has more than one non-blank line. There the first line is not a safe replacement (swapping a fence opener would leave its closing line to open a fence that swallows the next heading), so the write refuses with the OTHER_TEXT fix. Everything else it used to name is kept now.
- Guards: `adrHtmlHeld` and `adrFenceHeld` unchanged and still refuse, conservatively, whenever a block takes a heading into the section.
- `--by N`: `adr-status` writes only `Superseded by <path>` as the status; it never writes a `Supersedes` line (the new ADR has it), so nothing is duplicated. A kept line that already cites ADR N (by number `ADR N` or the path's file name) adds a note, never a second line.
- adr-commonmark-diff: the oracle reads the whole section, so every multi-line section reads differently on purpose; one-line sections must stay right. Report counts.
- Docs: record-decision step 7 and its scenario/golden, adr-status.md, README, CHANGELOG.
