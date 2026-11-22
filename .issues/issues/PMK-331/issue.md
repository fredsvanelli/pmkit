---
id: PMK-331
title: Tally the corpus HTML ends apart and guard the one-space write in npm test
type: chore
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-331-tally-the-corpus-html-ends-apart-and
created: 2026-11-15T23:21:51.307Z
updated: 2026-11-22T02:12:22Z
---

## Description

### Context

PMK-327 (PR #303) put HTML blocks in containers, status lines next to breaks and one-space lines in the corpus of `scripts/dev/adr-commonmark-diff.mjs`. Its review left gaps, checked at b3533a59:

- **The tally.** The driver tallies container cases by the name of their end. The HTML cases share the PMK-321 end names, so `end of file` adds 16 fence or `<div>` cases to the HTML ones and every tally line still says `(PMK-321)`. Acceptance criterion 2 of PMK-327 could not be read from the output alone; the reviewer had to relabel the cases.
- **A check that cannot fail.** In `scripts/dev/adr-write-compare.test.mjs`, `isStatus` is `STATUS_NEAR.includes(line)`, true by construction for every line it checks, so the status-then-break test never fails on a non-status line.
- **No guard on the one-space write in `npm test`.** The test checks the shape of `oneSpacePairs`, not that `setAdrStatus` writes one of its bodies in place, which is what makes the one-space mutation exit 1. The first run of PMK-327 missed exactly that, since next to a break line the write adds a line instead.
- **Counts in words.** The comment above the `cases()` total lists `240 + 1,638 + 42,588` and leaves out the `3,766` the assertion adds. The code comment and the CHANGELOG say the pairs and triples hold one-space lines "among them", but only the 812 bodies of `oneSpacePairs` written in place can catch the mutation.

Source: PMK-327 (PR #303, review cycle 1, notes N1 to N4 and N8).

### Scope (in)

- The tally keeps the HTML container cases apart from the PMK-321 ones (by kind or by a tagged end), with a label that says which.
- `isStatus` checks the issue's own rule (`STATUS_WORDS` and `STATUS_OTHER`), not the list the corpus is built from.
- A test that `setAdrStatus` writes at least one `oneSpacePairs` body in place over its one-space line.
- The count comment and the "among them" wording match the code.
- The older cases stay the same and in order (the PMK-324 prefix test stays green, its constant unchanged).

### Out of scope

- `scripts/lib`, and the shared `pairsAround` and `containerCases` simplifications (review notes N5 and N6).

### Tasks

- [ ] Tally the HTML container cases apart
- [ ] Make `isStatus` a real check, and guard the one-space in-place write
- [ ] Fix the count comment and the wording

## Acceptance criteria

- [x] The full run's tally shows the HTML container cases by kind or tagged end, apart from the PMK-321 ones, so a `--base 3fb6707b` run shows the 60 HTML end-of-file writes on their own lines, in the PR
- [x] `isStatus` fails on a non-status line (shown by a mutation), and a test fails when no `oneSpacePairs` body is written in place over its one-space line (shown by a mutation), with the PMK-324 prefix test green and its constant unchanged
- [x] The count comment and the CHANGELOG and code wording match the code; nothing in `scripts/lib` changes
