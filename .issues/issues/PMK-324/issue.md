---
id: PMK-324
title: Put status lines with a hard break in the adr-commonmark-diff corpus
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-324-put-status-lines-with-a-hard-break-in
created: 2026-11-14T20:46:32.811Z
updated: 2026-11-14T21:36:24Z
---

## Description

### Context

Since PMK-321, `compareWrites` in `scripts/dev/adr-write-compare.mjs` checks that the in-place write keeps the hard break of the line it replaces (two or more trailing spaces, or an odd number of trailing backslashes, copied as `hardBreak`). The corpus of `scripts/dev/adr-commonmark-diff.mjs` barely exercises it. Checked at bac7dc92:

- No line of the corpus holds a backslash: a write that drops a `\` hard break passes the full run with 0 worse (PMK-321 review cycle 1: that mutation exits 0; only the drift test in `npm test` catches it).
- The only status lines with trailing spaces are the 40 `  Accepted  ` cases of `CONTAINERS` (PMK-321); `STATUS_WORDS` has none, so the pairs, triples and random status runs never write over a hard break.

Source: PMK-321 (PR #292, implementer follow-up and review cycle 1).

### Scope (in)

- Status lines ending in two or more spaces, in one backslash and in two backslashes (not a break) in the status words of the corpus, so the pairs, triples and random runs meet them.
- The mutations that drop the space break and the `\` break exit 1, and no mutation exits 0, shown in the PR.

### Out of scope

- `adr.mjs`: only `scripts/dev`.
- The other PMK-321 notes (spec and plan without the one-line section exception, a drift test for `STATUS`, a tautological expectation in the test).

### Tasks

- [ ] Add status lines with trailing spaces and backslashes to the status words of the corpus
- [ ] Run the full comparison from 3f24c7e6 to develop and the hard-break mutations, and note the run time

## Acceptance criteria

- [ ] The corpus holds status lines ending in two or more spaces, in one backslash and in two backslashes, in the pairs, triples and random status runs, and the old cases stay the same and in order
- [ ] A write that drops the `\` hard break, and one that drops the space break, each exit 1 on the full run, and with no mutation the run from 3f24c7e6 to develop exits 0 with 0 worse, with the counts and run time in the PR
