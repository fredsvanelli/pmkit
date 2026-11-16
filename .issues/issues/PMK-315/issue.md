---
id: PMK-315
title: Exercise the status line choice in adr-commonmark-diff
type: chore
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-315-exercise-the-status-line-choice-in-adr
created: 2026-11-14T05:29:38.227Z
updated: 2026-11-14T06:31:11Z
---

## Description

### Context

`scripts/dev/adr-commonmark-diff.mjs` checks the extent of the `## Status` section against CommonMark on 1,098,320 generated bodies, and since PMK-311 it also counts how `adrInfo` reads the status. Its corpus has no status words, so after the PMK-311 rule (only a line that reads as a known status is the status) `adrInfo` reads the whole section in every case and the count "one line of it" is 0: the choice of the status line and what the in-place write keeps are covered by unit tests only. The PMK-311 review needed a separate fuzz of 900 thousand sections, comparing what each write deletes against develop, to check that choice. The script also counts an empty status as "one line of it". Checked at 5d09c170. Source: PMK-311 (PR #278, review cycles 2 and 3).

### Scope (in)

- Status words (`Accepted`, `Proposed`, `Superseded by ADR 2`, with and without emphasis), date lines, `Supersedes` lines and `Key: value` lines in the generated bodies, so the line choice is exercised.
- For each body, what `setAdrStatus` removes at the base ref and at the head ref, with a count of bodies where the head removes text the base kept or refused.
- An empty status counted on its own.

### Out of scope

- `scripts/lib/adr.mjs` and the rules it applies.
- Running the script in `npm test` (it needs the commonmark package and minutes of time).

### Tasks

- [ ] Add status, date, Supersedes and Key: value lines to the corpus
- [ ] Compare what the write removes at both refs
- [ ] Count an empty status separately

## Acceptance criteria

- [x] Run from 3f24c7e6 to 5d09c170, the script reports a non-zero count of bodies where the status is one line of the section and 0 bodies where the head removes text the base kept, with the run in the PR
- [x] A mutation that makes the in-place write drop a kept line (in a temporary copy) makes the script report it and exit 1, shown in the PR
- [x] An empty status is counted on its own line of the report
