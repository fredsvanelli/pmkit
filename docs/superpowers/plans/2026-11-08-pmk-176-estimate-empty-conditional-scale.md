# PMK-176 Implementation Plan: estimate command on an empty or conditional scale

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** `/pmkit:issues:estimate` falls back to a comment on a conditional or unmapped estimate, uses the issue team's scale, never writes days as points, and asks even when the proposal equals the current estimate.

**Architecture:** Only the command file changes; `capabilities` and `discover` already carry the data. A static test pins the rules in the file.

**Tech Stack:** Markdown command file, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-176-estimate-empty-conditional-scale-design.md`

## Global Constraints

- Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; every commit carries `(PMK-176)`.
- No new CLI call in the command file, so the `issues-estimate` scenario and its snapshot stay unchanged.
- Every CLI call in the file ends with `--json`.

## Review Focus

- `conditional` with the issue's team outside `detail.teams`: comment path (test: file mentions `detail.teams`).
- Native dry run failing with `NOT_SUPPORTED`: comment path, no retry (test: file mentions `NOT_SUPPORTED`).
- Empty scale (`scale: []`) on a native path: no `--estimate` with days (test: file says days go only in the comment).
- Proposal equals current: still asks (test: the old "say that the estimate already fits and stop" sentence is gone).

---

### Task 1: Pin the rules, then fix the command file

**Files:**
- Create: `scripts/estimate-command.test.mjs`
- Modify: `commands/issues/estimate.md` (steps 1, 3, 6, 7, 8, Confirmation points, Output, If something is missing)
- Modify: `CHANGELOG.md` (line at the top of `## Unreleased`)

- [ ] **Step 1: Write the failing test** `scripts/estimate-command.test.mjs` with tests `conditional falls back to a comment`, `a refused estimate field falls back to a comment`, `the scale is the one of the issue's team`, `days never reach --estimate`, `an equal proposal still asks`. Each reads `commands/issues/estimate.md` (CRLF normalized) and asserts by regex: `conditional` and `detail.teams`; `NOT_SUPPORTED`; `teams` with the issue ID prefix; `ideal days` only in a sentence that also says `comment`; absence of `and stop` after `equals the current estimate`.
- [ ] **Step 2:** Run `node --test scripts/estimate-command.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Edit the command file as in the spec's Design section.
- [ ] **Step 4:** Run the new test, then `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Add the CHANGELOG line; commit `fix(estimate): ... (PMK-176)`.

### Task 2: Close the issue work

- [ ] Tick criteria 1 to 3 with `issues update PMK-176 --check n` (dry run, then real); commit `.issues/`.
- [ ] `npm test` in the foreground, exit code 0; then deliver through `pr open`.
