# PMK-318: catch a wrong replaced line and duplicated or moved lines in the write check (design)

Small change (estimate 1). Only `scripts/dev/adr-write-compare.mjs` and its test, the wiring in `scripts/dev/adr-commonmark-diff.mjs`, and a CHANGELOG line. `scripts/lib/adr.mjs` is out of scope.

## Why
`compareWrites` (PMK-315) excuses the head's own `adrInfo(text).status` from the removed text, so a head that picks the wrong line is excused by its own pick. `removedLines` is a multiset difference, so a duplicated, reordered or moved line removes nothing by that measure.

## Goals
- A head write is checked by shape, not by what it removes: it either replaces exactly one line, in place, where that line reads as a known status and every other line of the document is the same, in order and byte for byte (`inPlace`); or it replaces a whole section, which is the only other thing the head does on purpose (a section with no known status line, PMK-311) and has exactly one new non-blank line, with every other non-blank line in order.
- A duplicated, reordered or moved line (more than one new line, or a line out of order) is `worse`, whatever the base did.
- A line replaced in place that is not a known status is `worse` (the issue's `Date: 2024-01-02`).
- The legitimate in-place replacement with a hard line break (PMK-314, the break stays on the replaced line) and the whole-section replacement are not worse.

## Definitions
- **Shape of a write** (`writeShape(before, after)`, pure): the raw lines are compared from both ends. `inPlace` is one differing line on each side and the old one reads as a known status. Independently, the trimmed non-blank lines are compared the same way: `rewritten` is the span the write replaced and `written` the span it put there. A whole-section write has one `written` line; a duplicate, reorder or move has more.
- **Known status.** The first word of the line (emphasis and punctuation skipped) is one of `accepted deprecated superseded proposed rejected draft`, in any case. This is a copy of the PMK-311 rule (`readsAsStatus` in `scripts/lib/adr.mjs`), kept in the helper on purpose: the rule must not come from the head under test, that is the defect of PMK-315. The two can drift; a change to the rule has to touch both.
- **Compare.** Head refused or threw: as before. Head `inPlace`: nothing extra (not worse; `acceptedWhereRefused` when the base refused, else `same`). Head not in place and not a single-line whole replacement: `worse`. Whole replacement: as today, the head's removed lines minus the base's (a base that refused removes nothing), and the one line of a one-line section is excused. That one-line check uses the section CommonMark reports, not the head's reading.

## Approaches
1. Shape check of the whole document, plus a base comparison for whole-section writes (chosen: catches every kind at once, no per-case rules).
2. Keep the multiset and only validate the excused line against the known-status rule: leaves duplicate, reorder and move undetected.
3. Import `readsAsStatus` from the head: same defect as before.

## Evidence
Full run `--base 3f24c7e6 --head 46e15ecd` (0 worse, exit 0), mutation runs in a temporary copy (date line replaced instead of the status; a kept line duplicated: both exit 1), pure tests in `scripts/dev/adr-write-compare.test.mjs`.
