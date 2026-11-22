# PMK-355 Issues Move Epic Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The epic path of `/pmkit:issues:move` runs as a scenario, with the harness checking its dry run and confirmation before the real run.

**Architecture:** `parseCommandFile` reads `## <name> path` as steps with a prefix; rules 6 and 7 take the union of the command's other scenarios (`siblingCoverage`); `issues-move.mjs` exports the issue and the epic scenario.

**Tech Stack:** Node 18+, `node:test`, the scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-355-issues-move-epic-scenario-design.md`

## Global Constraints

- Other command files and their scenarios unchanged; commands with one scenario keep their rules as before.

## Review Focus

- A sibling entry with function args: left out of the union, the conservative side.
- A stale `skip` in one scenario: still reported, per scenario.
- `## Epic path` before `## Confirmation points`: the points parser is unchanged.

---

### Task 1: Parser and sibling coverage

- [ ] Failing tests in `scripts/scenario-helpers.test.mjs`: `## Epic path` items get `Epic path N`; a key or point a sibling uses, confirms or excuses is covered, a stale skip still reported.
- [ ] Implement in `parseCommandFile`, `coverageProblems(…, siblings)`, `pointProblems(…, siblings)`, `runScenario({ siblings })`, `siblingCoverage(entries, index, parsed, cliNames)`; wire it in `scripts/scenarios.test.mjs`.

### Task 2: The epic scenario

- [ ] `issues-move.mjs` exports `[issue, epic]`; the issue entry loses `skip['1 epic get']` and `notHit['Epic path, step 2']`; the epic entry reads, previews, confirms and moves `EPC-2M9D` to done.
- [ ] Rename the snapshot to `issues-move.0.after.txt`; generate `issues-move.1.after.txt` with `UPDATE_GOLDENS=1`.
- [ ] Mutations: drop the confirm (rules 7 and 9), move the dry run after the write (rule 9). Revert.
- [ ] CHANGELOG, `npm test`, `npm run lint`, commit.
