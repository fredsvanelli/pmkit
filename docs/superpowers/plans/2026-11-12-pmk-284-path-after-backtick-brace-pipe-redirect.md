# PMK-284 Path after a backtick, brace, pipe or redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `hideAbsolutePaths` hides a path after `` ` ``, `{`, `|`, `>` and closes a quote before `]` or `>`.

**Architecture:** Edit the two regexes in `scripts/lib/paths.mjs`. Name and signature stay (PMK-289 calls it).

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-284-path-after-backtick-brace-pipe-redirect-design.md`

## Global Constraints

- O'Brien (PMK-271) and URL (PMK-278) tests keep their expectations. Only the PMK-277 `['/Users/x y'] and '/b c/d'` expectation changes.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID in each message.

### Task 1: Tests first

- [ ] Add to `scripts/paths.test.mjs`: unquoted starts (`` a`/Users/x ``, `{/Users/x}`, `a|/Users/x`, `a>/Users/x` hidden); backtick quoted (`` x `/Users/a/r` y `` -> `` x `<path>` y ``, with a space in the path too); quote then `]` or `>` (`'/Users/a/r'] gone` -> `'<path>'] gone`, `"/a b"> ok`, `<'/Users/x y'>`); ordinary text with the new characters unchanged (`a|b`, `{a/b}`, `a > b/c`). Update the PMK-277 expectation.
- [ ] Run `node --test scripts/paths.test.mjs`; the new tests FAIL.

### Task 2: Regex change

- [ ] Rule 1: lookbehind gets `` ` ``, `{`, `|`, `>`; quote set `['"` + backtick; lookahead `(?=$|[\s:)\]>])`. Rule 2: same start additions. Update the doc comment.
- [ ] Run `node --test scripts/paths.test.mjs`; all PASS.
- [ ] Commit `fix(paths): hide a path after a backtick, brace, pipe or redirect (PMK-284)` with `.issues/` changes.

### Task 3: Delivery

- [ ] CHANGELOG line at top of `## Unreleased`; `npm test` in the foreground, exit 0.
- [ ] Check criteria 1 and 2 (`issues update PMK-284 --check n`, dry-run then real); commit `.issues/`.
- [ ] Post the plan as a comment, open the PR, comment, move to `in_review`.
