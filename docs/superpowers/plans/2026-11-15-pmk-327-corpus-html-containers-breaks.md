# PMK-327 corpus: HTML containers, status-then-break, one-space lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Append HTML-in-container cases, status-then-break pairs and triples and one-space status lines to the adr-commonmark-diff corpus, with a test that fails when any generator loop is dropped.

**Architecture:** New lists and generators in `scripts/dev/adr-write-compare.mjs`, yielded at the end of `cases()` after `breakRuns`. The `CONTAINERS` loop becomes `containerCases(opens, ends)`, reused for the HTML opens.

**Tech Stack:** Node 22 ESM, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-15-pmk-327-corpus-html-containers-breaks-design.md`

## Global Constraints

- Only `scripts/dev/` (plus CHANGELOG, `.issues/`, docs). Nothing in `scripts/lib` changes on the branch; the `hardBreak` mutation is a temporary edit for the `--head worktree` run only, never committed.
- The PMK-324 prefix-hash test stays green with its constant `9f2f6b6c…fdf5` unchanged.
- Every commit carries `PMK-327` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- `CONTAINERS` rebuilt by `containerCases` must be byte-identical: pinned by the prefix-hash test (Task 1 step 4).
- The no-final-newline end must really have no trailing `\n`: content check in Task 1's test.
- `ONE_SPACE` lines must not count as a break (`hardBreak(line) === ''`): asserted in Task 1's test.
- PMK-324 cases unchanged: `breakPairs`/`breakTriples` counts stay 16,947 / 965,979.

---

### Task 1: New corpus cases and the per-loop test

**Files:**
- Modify: `scripts/dev/adr-write-compare.mjs` (CONTAINERS block, after `breakRuns`, `cases()`)
- Test: `scripts/dev/adr-write-compare.test.mjs`
- Modify: header comment of `scripts/dev/adr-commonmark-diff.mjs`

**Interfaces:**
- Produces (exports): `ONE_SPACE = ['Accepted ', '  Proposed ']`, `HTML_CONTAINERS` (array of `{ text, end }`), `statusBreakPairs()`, `statusBreakTriples()` (generators of bodies).

- [ ] **Step 1: Write the failing tests**

`'each generator loop of the corpus has its own size, so dropping one fails (PMK-327)'`:
- `breakPairs` count 16,947 (9·151·7 + 118·9·7 = 9,513 + 7,434), `breakTriples` 965,979 (513·151·7 + 513·118·7 = 542,241 + 423,738), `statusBreakPairs` 1,638 (26·9·7), `statusBreakTriples` 42,588 (26·26·9·7), `HTML_CONTAINERS.length` 240 (2·2·10·6), `cases({ seed: 1, random: 10, statusRandom: 10, breakRandom: 10, lines: 8 })` 2,217,822 (2,173,356 + 44,466).

`'the corpus holds HTML blocks of kinds 1 to 5 in containers, status lines before a break and one-space status lines (PMK-327)'`:
- for each open of `<!-- x`, `<?php`, `<![CDATA[`, `<!X`, `<script>`, each prefix `> ` / `- `, each end of `later line`, `blank`, `ATX heading`, `setext heading`, `end of file`, `end of file, no final newline`: some `HTML_CONTAINERS` case has that end and a line `prefix + open`; for the no-final-newline end, `text` does not end in `\n`.
- every `statusBreakPairs` body has line 1 not in `STATUS_BREAKS` and readsAsStatus, line 2 in `STATUS_BREAKS`; every `statusBreakTriples` body the same with lines 1–2 then line 3.
- `ONE_SPACE` lines end in exactly one space, `hardBreak` gives `''`, and both appear as line 1 of a `statusBreakPairs` body.

- [ ] **Step 2: Run** `node --test scripts/dev/adr-write-compare.test.mjs` — expected FAIL (imports undefined / counts).

- [ ] **Step 3: Implement** `containerCases(opens, ends)` (the old loop body; text: no `\n` for `end of file, no final newline`, `## Status\n\n${body}\n` for setext/EOF, else `textOf(body)`), `CONTAINERS = containerCases(['> ```', '- ```', '> <div>', '- <div>'], ENDS)`, `HTML_CONTAINERS` with the 10 opens and `{ ...ENDS, 'end of file, no final newline': [] }`, `STATUS_NEAR = [...STATUSY, ...ONE_SPACE]`, the two generators, and `yield* HTML_CONTAINERS; yield* statusBreakPairs(); yield* statusBreakTriples()` after `breakRuns` in `cases()`. Update the `cases()` doc comment and the driver header comment.

- [ ] **Step 4: Run** `node --test scripts/dev/adr-write-compare.test.mjs` — expected all PASS, including the unchanged prefix-hash test.

- [ ] **Step 5: Loop-drop mutations** — comment out each loop in turn (both loops of `breakPairs`, both of `breakTriples`, `statusBreakPairs`, `statusBreakTriples`, the `yield* HTML_CONTAINERS`, and each loop of `cases()`), run the test file, record pass/fail, revert. Every drop must FAIL. Script and log in the scratchpad `PMK-327/`.

- [ ] **Step 6: Commit** `test+feat: HTML containers, status-then-break and one-space corpus cases (PMK-327)`.

### Task 1b (ruling in execution): `oneSpacePairs()`

The one-space mutation exited 0: next to a break line the section has two status lines, so `setAdrStatus` adds a line instead of writing in place. Add `oneSpacePairs()` (mirror of `breakPairs` with `ONE_SPACE`, 3,766 cases, yielded last), test first: its count, `cases()` total 2,221,588, and a body with a one-space line before `Date: 2024-01-02` and after `lazy`. Rerun the loop drops (26, all fail).

### Task 2: Evidence runs (foreground, long timeout; commonmark 0.31.2 at scratchpad `PMK-327/cm/node_modules/commonmark`)

- [ ] `--base 3fb6707b --head HEAD`: container tallies for `end of file` and `end of file, no final newline` show `acceptedWhereRefused`, 0 worse, exit 0. Record time.
- [ ] Temporary `/ {1,}$/` in `scripts/lib/adr.mjs` `hardBreak`, `--base origin/develop --head worktree`: exit 1 with worse count; revert (`git diff --quiet scripts/lib`).
- [ ] No mutation, `--base 3f24c7e6 --head HEAD`: exit 0, 0 worse; counts and time.

### Task 3: Ship

- [ ] CHANGELOG line under `## Unreleased`; `npm test` exit 0; `/utils:review-work`; check ACs via `issues update PMK-327 --check <n>`; commit; `pr open`, `issues comment`, `issues move PMK-327 in_review`.
