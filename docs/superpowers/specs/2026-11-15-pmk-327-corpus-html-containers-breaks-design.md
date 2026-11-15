# PMK-327: HTML blocks in containers, status lines next to breaks and one-space lines in the adr-commonmark-diff corpus (design)

Small change (estimate 2). Only `scripts/dev/adr-write-compare.mjs`, its test, the header comment of `scripts/dev/adr-commonmark-diff.mjs` and a CHANGELOG line. `scripts/lib` does not change.

## Why
- The `CONTAINERS` cases open only a fence or `<div>`, so the full run never reaches the PMK-323 change (`adrHtmlHeld` for an HTML block of kind 1 to 5 its quote or list item holds at the end of the file).
- No pair has a status line right before a break line, no triple has two status lines then a break line.
- No status line ends in exactly one space, so a write that keeps one space as a hard break passes.
- The PMK-324 test checks kinds of line, not loops: dropping the second loop of `breakPairs` keeps it green.

## Goals
New cases appended after `breakRuns` in `cases()`, in this order; every older case stays the same and in order (the PMK-324 prefix hash test stays unchanged and green):
1. `HTML_CONTAINERS`: the `CONTAINERS` shape (status `Accepted` or `  Accepted  `, with and without a blank line, the open line, then `> ## X` or `  ## X`) with the opens `<!-- x`, `<?php`, `<![CDATA[`, `<!X`, `<script>` (kinds 2, 3, 5, 4, 1) after `> ` and after `- `, and the ends of `CONTAINERS` plus a new one, `end of file, no final newline` (`## Status\n\n<body>`, no `\n`). 2 x 2 x 10 x 6 = 240 cases. The loop that builds `CONTAINERS` becomes a function `containerCases(opens, ends)` used for both, so the shape cannot drift; `CONTAINERS` keeps its value (the prefix test proves it).
2. `statusBreakPairs()`: `s, b, u` with `s` in `STATUS_NEAR = [...STATUSY, ...ONE_SPACE]`, `b` in `STATUS_BREAKS`, `u` in `UNDERLINES` (26 x 9 x 7 = 1,638).
3. `statusBreakTriples()`: `s, t, b, u` with `s`, `t` in `STATUS_NEAR` (26 x 26 x 9 x 7 = 42,588).
4. `ONE_SPACE = ['Accepted ', '  Proposed ']`: status lines ending in one space (not a break, `hardBreak` gives `''`), a new list so `STATUS_BREAKS` and the PMK-324 cases do not change. They come before a break line in the pairs and triples above.

Corpus total at the defaults: 3,923,326 + 44,466 = 3,967,792 (a few seconds more on a run of about 2.5 min).

## Non-goals
- No change to `scripts/lib`, `compareWrites`, `hardBreak` or the comparison rules. A worse case found at develop goes to the coordinator, not into a fix.
- No new random runs (the pairs and triples cover the shapes exhaustively).

## Approaches
1. Append new lists and generators after every older case (chosen): older cases unchanged, the cost is 44,466 cases.
2. Add the lines to `STATUS_BREAKS` / the opens to `CONTAINERS`: shortest diff, but changes the PMK-321 and PMK-324 cases and their order. Rejected (the issue requires the older cases unchanged).
3. Add `ONE_SPACE` to `STATUS_ALL` and rerun the PMK-324 loops: changes PMK-324 cases. Rejected.

## Test: a test fails when any generator loop is dropped
A new test in `adr-write-compare.test.mjs` counts each generator loop of the corpus apart (exported generators, with small random counts): every loop of `breakPairs` (2), `breakTriples` (2), `statusBreakPairs` (1), `statusBreakTriples` (1), the count of `HTML_CONTAINERS`, and the total of `cases()` with fixed small parameters, against literal numbers with their formula in a comment. Dropping any one loop changes one count (each loop has a distinct size, and the total catches the loops inside `cases()`). Next to it, content checks: each kind 1 to 5 in a quote and in a list item with each of the 6 ends; a status line then a break line in the pairs and two status lines then a break line in the triples; a `ONE_SPACE` line with `hardBreak` `''` before a break line. The pre-PMK-324 loops are also pinned by the prefix hash test.
Red first: the new test fails until the code exists. Then each loop is dropped in turn (temporary edit, reverted) and the test must fail each time, including the second loop of `breakPairs`; the results go in the PR.

## Evidence for the PR (runs in the foreground, commonmark 0.31.2 in the scratchpad `PMK-327/cm`)
- AC2: `--base 3fb6707b --head HEAD`: the container tally `end of file` (list item) and `end of file, no final newline` (quote and list item) shows `acceptedWhereRefused` for the HTML kinds (a probe already shows 15 such bodies: 5 kinds x {quote no newline, item with, item without}), and 0 worse.
- AC3: `hardBreak` mutated in a temporary copy of `scripts/lib/adr.mjs` to keep one space (`/ {1,}$/`, reverted), `--head worktree`: exit 1 with its worse count (before this change it exits 0, shown on the old corpus if time allows). No mutation, `--base 3f24c7e6 --head HEAD`: exit 0, 0 worse, counts and run time.
