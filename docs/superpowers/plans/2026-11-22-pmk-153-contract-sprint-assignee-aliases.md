# PMK-153 Contract Sprint And Assignee Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The contract suite covers `current` with `dryRun`, the assignee aliases `me` and `none`, and an unknown sprint ID in `searchIssues`, and Local, Linear and GitHub pass it.

**Architecture:** Three new cases in `scripts/contract-suite.mjs`; Linear's `searchIssues` and GitHub's `sprintStep` refuse an unknown sprint ID with `INVALID_INPUT`, as Local does; the design spec says so.

**Tech Stack:** Node 18+, `node:test`, the Linear and GitHub fakes.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-153-contract-sprint-assignee-aliases-design.md`

## Global Constraints

- No dependencies. Error message for an unknown sprint: `sprint "<id>" is not current, none or an existing sprint id`, next step `pmkit cycle list`, code `INVALID_INPUT`.

## Review Focus

- Linear without a scope team, and with cycles off: unchanged behaviour.
- A live workspace with other issues: the `me`/`none` case filters to its own IDs.
- GitHub without a mapped iteration field: `none` still matches every issue, any other sprint stays `NOT_SUPPORTED`.

---

### Task 1: Contract cases (red)

**Files:** Modify `scripts/contract-suite.mjs`

- [ ] `cycles`: `sprint current with dryRun returns the active sprint id and writes nothing` (create, update, moveToCycle with `{ dryRun: true }`; `after.sprint === sprint.id`; `cycleIssues(sprint.id)` empty and `getIssue(plain).sprint` undefined after).
- [ ] `cycles`: `searchIssues with an unknown sprint id fails with INVALID_INPUT` (`unknownSprintLike(id)`: `/^\d+$/` → `String(Number(id) + 100000)`, a `YYYY-MM-DD` → `2099-12-31`, else null and skip; also `not-a-sprint`).
- [ ] `issues`: `searchIssues with assignee me returns the issues assigned to the actor, and none the unassigned ones`.
- [ ] Run `node --test scripts/contract.test.mjs scripts/lib/linear/contract.test.mjs scripts/lib/github/contract.test.mjs`: the unknown-sprint case fails on Linear and GitHub only.

### Task 2: Linear and GitHub refuse an unknown sprint ID

**Files:** Modify `scripts/lib/linear/issue-ops.mjs` (`searchIssues`), `scripts/lib/github/filter.mjs` (`sprintStep`)

- [ ] Linear: after `checkFilter`, when `filter.sprint` is neither `current` nor `none` and `current.scopeTeam` is set, `await cycleNodeFor(filter.sprint, teamOf(current, current.scopeTeam.id))`; turn its `NOT_FOUND` into `INVALID_INPUT` with the message above.
- [ ] GitHub: in `sprintStep`, after the mapped-field check, a sprint not `current`/`none` that is not an ID of `sprintsOf(mapped.field.configuration, today).sprints` throws `INVALID_INPUT` with the message above.
- [ ] Contract suites pass; adapter unit tests that assumed an empty list are updated.

### Task 3: Spec, CHANGELOG, checks

- [ ] Design spec Cycles row and `searchIssues` paragraph; CHANGELOG line; `npm test`, `npm run lint`; commit.
