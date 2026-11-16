# PMK-71 team-load command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pmkit team load` and `/pmkit:team:load`, which show issues, estimates and work in progress per member, flag imbalances and members with no work, and reassign after a full preview.

**Architecture:** A pure module `scripts/lib/team-load.mjs` computes the report from issues, members, sprint data and aging rows. A CLI command in `scripts/pmkit.mjs` reads the tracker and calls it. A command file presents the result and reassigns through `issues assign`.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-71-team-load-design.md`

## Global Constraints

- Imbalance threshold is 1.5 times the average of the human members.
- Load categories are `todo`, `in_progress` and `in_review`.
- Reassigning always shows the full preview and asks, whatever `write_policy.confirm` says.
- Agent members (`agent:<name>`) are outside the average, `noWork`, the flags and the reassign targets.
- Do not touch `scripts/lib/capabilities.mjs` or the Local tracker store.

## Review Focus

- A tracker with no sprints: scope is every open issue, with a note.
- Estimation `absent`, or no issue with an estimate: unit is `issues`, with a note.
- Mixed estimated and unestimated issues: points, with `unestimated` counted.
- One human member: no average-based flag.
- An assignee that is not a member: shown, never a target.

### Task 1: The calculation module

**Files:**
- Create: `scripts/lib/team-load.mjs`, `scripts/team-load.test.mjs`

**Interfaces:**
- Produces: `teamLoad(issues, { members, aging, sprint, capacity, daysOff, unit }) -> { unit, rows, unassigned, noWork, imbalances }`, `chooseUnit(issues, estimationPath) -> { unit, reason }`, `suggestMoves(report, issues) -> [{ issue, from, to }]`, `OVER_AVERAGE = 1.5`.
- `issues` are open issues in scope as `searchIssues` returns them. `members` is `discover().members` (`id`, `name`, `availability`). `aging` is the output of `aging()` in `metrics.mjs`.

- [ ] **Step 1: Write failing tests** in `scripts/team-load.test.mjs`: `chooseUnit` returns `issues` for `absent`, `issues` when no estimate is set, `points` otherwise; `teamLoad` counts issues, points, `unestimated`, `wip` and `oldestWipDays` per member; agents and non-members are rows outside the average; `noWork` lists a human with zero load and skips `availability` 0; `over_average` fires above 1.5 times the average and not with one human; `over_capacity` fires on points above capacity; `suggestMoves` moves only `todo` issues from an over member to the lowest-load human, largest first, never leaving the target above the source.
- [ ] **Step 2: Run** `node --test scripts/team-load.test.mjs`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the three functions in `scripts/lib/team-load.mjs`, pure, with rows ordered as members, then agents, then non-members.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(team): add the team-load calculation (PMK-71)`.

### Task 2: The CLI command

**Files:**
- Modify: `scripts/pmkit.mjs` (entry `team load`, flag `sprint`), `scripts/cli.test.mjs` (READS list), `README.md` (CLI table row)
- Test: `scripts/cli-team-load.test.mjs`

**Interfaces:**
- Consumes: Task 1 functions, `flowInputs`, `capabilityNotes`, `table`.
- Produces: `pmkit team load [--sprint current|<id>] [--json]`, data `{ sprint, unit, rows, unassigned, noWork, imbalances, suggestions }`, and `note:` lines.

- [ ] **Step 1: Write failing CLI tests**: the `team` fixture gives a sprint scope and both members; the `no-sprints` fixture gives the whole-tracker scope and a note; estimates removed from every issue give unit `issues` and a note; `--sprint` with an unknown id fails with `NOT_FOUND`.
- [ ] **Step 2: Run** `node --test scripts/cli-team-load.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the entry. A `NOT_SUPPORTED` from `currentCycle`, `getCapacity` or `getDaysOff` falls back to no sprint or no capacity, with the `cycles` or `capacity` note.
- [ ] **Step 4: Run** the new test and `node --test scripts/cli.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(team): add pmkit team load (PMK-71)`.

### Task 3: The command file, scenario and docs

**Files:**
- Create: `commands/team/load.md`, `scripts/__scenarios__/team-load.mjs` and its `.after.txt`
- Modify: `scripts/scenarios.test.mjs` (36 to 37 and the related counts), `scripts/scenarios-live.mjs`, `scripts/plugin.test.mjs` (`COMMANDS.team`), `skills/pmkit/SKILL.md`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Add** `load` to `COMMANDS.team` and bump the file count. Run `node --test scripts/plugin.test.mjs scripts/scenarios.test.mjs`. Expected: FAIL, file missing.
- [ ] **Step 2: Write** `commands/team/load.md` in the shape of `risk-radar.md`, with the four steps of the spec, the confirmation points and the missing-data section.
- [ ] **Step 3: Write** the scenario on the `team` fixture: read `team load`, dry-run two `issues assign` calls, answer yes, run them, read `team load` again. Generate the snapshot with `UPDATE_GOLDENS=1`.
- [ ] **Step 4: Update** the README command list, the skill table and the top of `## Unreleased` in the CHANGELOG.
- [ ] **Step 5: Run** `npm test`. Expected: PASS. Commit `feat(team): add /pmkit:team:load (PMK-71)`.
