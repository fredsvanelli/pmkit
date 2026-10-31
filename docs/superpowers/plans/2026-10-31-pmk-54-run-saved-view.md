# PMK-54 run-saved-view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/pmkit:issues:run-view`, a command file that runs a saved view and shows the issue table.

**Architecture:** A markdown command that calls `views list` and `views run`. No CLI change.

**Spec:** `docs/superpowers/specs/2026-10-31-pmk-54-run-saved-view-design.md`

## Global Constraints

- Command files keep the five sections that `scripts/plugin.test.mjs` checks.
- Keep edits to `README.md`, `CHANGELOG.md`, `skills/pmkit/SKILL.md` and the counts small, because PMK-58, PMK-63 and PMK-73 edit them in parallel.

## Review Focus

- A missing view: step 4 suggests `views list` and does not guess a name.
- An out of date view: shows the stored filter and the `--overwrite` fix, runs nothing by itself.
- A broken view file: never replaced by a filter run, points to `pmkit validate`.
- Linear (`saved_views` absent): says so and offers `issues list` with the same filter.
- A cut or incomplete read: reported as incomplete, never as the full list.

### Task 1: Command, scenario and docs

**Files:**
- Create: `commands/issues/run-view.md`, `scripts/__scenarios__/issues-run-view.mjs` and its golden
- Modify: `scripts/plugin.test.mjs` (`COMMANDS.issues`), `scripts/scenarios.test.mjs` (46 files), `scripts/scenarios-live.mjs` (`LIVE_EXPECT_STOPS`), `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`

- [ ] Add `run-view` to `COMMANDS.issues` and bump the file count, and see the tests fail.
- [ ] Write the command file and the scenario, then run `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`.
- [ ] Add the README, SKILL and CHANGELOG lines.
- [ ] Run `npm test` in the foreground and expect exit code 0.
- [ ] Commit with `(PMK-54)`.
