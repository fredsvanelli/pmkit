# PMK-154 No Active Sprint Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The no-active-sprint warning reaches `--json` for `issues list` and `views run`, `issues bulk` gives it too, and the conventions and command files tell the agent to show warnings.

**Architecture:** `issueSearchResult` puts its printed warning lines in `data.warnings` when there are any; `runBulk` adds the sprint line; one conventions rule; two command-file clauses.

**Tech Stack:** Node 18+, `node:test`, CLI subprocess tests.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-154-no-active-sprint-warning-design.md`

## Global Constraints

- The warning text stays `there is no active sprint, so --sprint current matches no issues; run pmkit cycle list` (one constant, `NO_ACTIVE_SPRINT`).
- No `warnings` key when there is none, so the JSON of a clean search is unchanged.

## Review Focus

- A view whose filter has `sprint: current`.
- A bulk with `--sprint current` while a sprint is active: no warning.
- GitHub's own search `warnings` stay in the list.

---

### Task 1: JSON and bulk (red, then green)

**Files:** `scripts/pmkit.mjs` (`issueSearchResult`, `runBulk`), the test file holding the PMK-116 case, `scripts/cli-bulk.test.mjs`

- [ ] Tests: `issues list --sprint current --json` with no active sprint has `warnings: [NO_ACTIVE_SPRINT line]` and `issues: []`; `views run <view with sprint current> --json` the same; `issues list --json` with no warning has no `warnings` key; `issues bulk priority high --sprint current --dry-run --json` with no active sprint has the line in `data.warnings` and on stderr.
- [ ] Run them: red.
- [ ] Implement; run them: green.

### Task 2: Conventions and command files

- [ ] `conventions.md`: rule 5 "Show every warning" (renumber the rest); `find.md` step 6; `bulk.md` `writes` is `0` bullet. Check the scenario and plugin tests still pass (rule numbers referenced anywhere?).
- [ ] CHANGELOG; `npm test` (goldens with `UPDATE_GOLDENS=1` only where a case has a warning); `npm run lint`; commit.
