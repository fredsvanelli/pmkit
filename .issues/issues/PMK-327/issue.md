---
id: PMK-327
title: "Put HTML blocks in containers, status lines next to breaks and one-space lines in the adr-commonmark-diff corpus"
type: chore
status: backlog
priority: low
estimate: 2
assignee: fred
parent: EPC-6
created: 2026-11-15T00:13:36.029Z
updated: 2026-11-15T00:13:36Z
---

## Description

### Context

The corpus of `scripts/dev/adr-commonmark-diff.mjs` (in `scripts/dev/adr-write-compare.mjs` since PMK-324) misses three things the last round changed or added. Checked at a9ce211c by running the generators:

- **HTML in a container.** The `CONTAINERS` cases open only a fence or `<div>` in a quote or list item. Over the whole default corpus (3,923,326 cases), `adrHtmlHeld` gives the same result at 3fb6707b (before PMK-323) and at a9ce211c on every case, so the full run never reaches the PMK-323 change and its `0 worse` says nothing about it (PMK-323 review note 6).
- **Status lines next to a hard break.** `breakPairs` puts only `ALPHABET` lines before a break line: 0 of its 16,947 pairs have a status line (`STATUS_WORDS`, `STATUS_OTHER`) right before one. `breakTriples` never has two status lines then a break line: 0 of 965,979. Only 5,623 of the 250,000 `breakRuns` meet that shape by chance. The PMK-324 test checks that each kind of break line appears in the pairs, triples and runs, not each loop: with the second loop of `breakPairs` removed it still passes (2 pass, 0 fail) (PMK-324 review N1).
- **One trailing space.** No status line in the corpus ends in exactly one space (0 of 3,923,326 cases), so a write that copies one space as if it were a hard break exits 0 (PMK-324 review N3).

Source: PMK-323 (PR #296, review cycle 1) and PMK-324 (PR #298, review cycles 1 and 2).

### Scope (in)

- Container cases with an HTML block of kind 1 to 5 (`<!--`, `<?php`, `<![CDATA[`, `<!X`, `<script>`) in a quote and in a list item holding `## X`, with the ends the `CONTAINERS` cases already use and the end of the file with and without a final newline.
- Pairs of a status line then a break line, and triples of two status lines then a break line.
- A status line ending in one space (not a break) among the status lines with breaks.
- A test that fails when any one generator loop is dropped.
- The new cases come after the older ones, which stay the same and in order (the PMK-324 prefix test stays green).

### Out of scope

- `scripts/lib`: only `scripts/dev`.

### Tasks

- [ ] Add the HTML container cases, the pair and triple loops and the one-space line
- [ ] Make the corpus test fail when a loop is dropped
- [ ] Run the full comparison and the mutations, and note the run time

## Acceptance criteria

- [ ] The corpus holds the HTML container cases for kinds 1 to 5, the status-then-break pairs and triples and a one-space status line, after the older cases, which stay the same and in order, and a test fails when any generator loop is dropped
- [ ] A run with `--base 3fb6707b` (before PMK-323) shows the end-of-file cases PMK-323 changed (a quote with no final newline, a list item with or without one) written by the head where the base refuses, and none worse
- [ ] A write that keeps one trailing space as a hard break exits 1 on the full run, and with no mutation the run from 3f24c7e6 to develop exits 0 with 0 worse, with the counts and run time in the PR
