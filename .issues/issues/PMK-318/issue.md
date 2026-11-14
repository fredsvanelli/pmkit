---
id: PMK-318
title: Catch a wrong replaced line and duplicated or moved lines in the adr-commonmark-diff write check
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-318-catch-a-wrong-replaced-line-and
created: 2026-11-14T15:52:57.323Z
updated: 2026-11-14T17:35:29Z
---

## Description

### Context

`scripts/dev/adr-commonmark-diff.mjs` compares what `setAdrStatus` removes at the base and the head ref (PMK-315, `compareWrites` in `scripts/dev/adr-write-compare.mjs`). It misses three kinds of loss, checked at 46e15ecd by calling the helper:

- The head's status line is excused from the removed text, and it is the head's own `adrInfo(text).status`. A head that picks the wrong line and replaces it, where the base refused, is counted as "written at the head where the base refused" and the run exits 0: `compareWrites({ base: { refused: true }, head: { removed: ['Date: 2024-01-02'] }, headStatus: 'Date: 2024-01-02' })` gives `acceptedWhereRefused`.
- `removedLines` is a multiset difference of the lines before and after, so a write that duplicates a kept line, reorders the lines, or moves text out of the Status section (below the next heading) removes nothing by that measure: `Accepted` + `Date: x` written as `Superseded by s` + `Date: x` twice removes only `Accepted`.

Source: PMK-315 (PR #282, review cycle 1).

### Scope (in)

- The excused line is a line that reads as a known status (the rule of PMK-311), or the check that the write replaced exactly one line, in place, and kept every other line of the section in order and byte for byte.
- A duplicated, reordered or moved line counts as worse.

### Out of scope

- `scripts/lib/adr.mjs` and the rules it applies.
- Running the script in `npm test`.

### Tasks

- [ ] Excuse only a status line that reads as a known status, or compare the kept lines in order
- [ ] Catch duplicated, reordered and moved lines

## Acceptance criteria

- [x] `compareWrites` (or its replacement) reports worse for a head that replaces a line that is not a known status, and for a duplicated, reordered or moved line, with tests in `scripts/dev/adr-write-compare.test.mjs`
- [x] Run from 3f24c7e6 to 46e15ecd in full, the script reports 0 worse and exits 0, with the run in the PR
- [x] A mutation in a temporary copy that makes the in-place write replace the date line instead of the status makes the script exit 1, shown in the PR
