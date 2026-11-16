# PMK-224 improve team capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** `team capacity` recomputes capacity when days off change; `cycle capacity` takes `current` and Linear checks the team; the write path builds the load report with no unused work.

**Architecture:** a pure `recomputeCapacity` in `team-capacity.mjs` feeds the one `updateCycleCapacity` call of `runTeamCapacity`; `cycle capacity` resolves `current` before calling the tracker; the Linear adapter filters members by team.

**Tech Stack:** Node ESM, no dependencies (ADR 0003), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-224-improve-team-capacity-design.md`. Each step is test first.

## Global Constraints

- Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the issue ID in every message. No dependencies. CRLF normalised on reads. Never run the CLI inside `scripts/__fixtures__/`.

## Review Focus

- Member with no capacity and a days-off change: stays unset, never 0.
- `--days-off` and `--set` naming the same member: `--set` wins.
- All working days taken off (new 0) and a sprint whose old working days are 0.
- `cycle capacity current` with no active sprint, and on Linear with cycles off.
- Linear member that exists in the workspace but not in the team.

## Task 1: recompute capacity (criterion 1)
- [ ] Failing unit tests in `scripts/team-capacity.test.mjs` for `recomputeCapacity(sprint, capacity, beforeOff, afterOff, set)`: 10 to 9 working days scales 10 to 9; `set` member skipped; member without capacity skipped; old working days 0 keeps it and reports it; new 0 gives 0; returns `{ capacity, recomputed, skipped }`.
- [ ] Implement it in `scripts/lib/team-capacity.mjs`.
- [ ] Failing CLI tests in `scripts/cli-team-capacity.test.mjs`: `--days-off` alone changes the capacity and lists `recomputed`; `--set` for the same member wins; dry run writes nothing; the note appears.
- [ ] Wire it into `runTeamCapacity`; add `recomputed` to the write result and text; note and warning lines.
- [ ] Commit `feat(team): recompute capacity when days off change (PMK-224)`.

## Task 2: `cycle capacity current` and the Linear team check (criterion 2)
- [ ] Failing tests: `cycle capacity current` reads and writes the active sprint, and answers `NOT_FOUND` with no active sprint (Local, `scripts/cli.test.mjs` or the existing cycle capacity test file); Linear refuses a member of another team (`scripts/cli-linear.test.mjs` or the cycle-ops tests) and accepts a team member.
- [ ] Resolve `current` in `cycle capacity`; filter the members by `user.teams.includes(team.id)` in `scripts/lib/linear/cycle-ops.mjs`.
- [ ] Commit `feat(cycle): cycle capacity takes current and Linear checks the team (PMK-224)`.

## Task 3: no unused work on the write path (criterion 3)
- [ ] Add the `proposals` option to `buildLoadReport` (default on), off in `runTeamCapacity`. Existing tests stay green and prove the output is unchanged.
- [ ] Commit `refactor(team): team capacity builds no move proposals (PMK-224)`.

## Task 4: docs
- [ ] `commands/team/capacity.md` (steps 3, 5, the days-off sentence), README rows, `skills/pmkit/SKILL.md` if it describes these, `CHANGELOG.md` line at the top of `## Unreleased`, golden/scenario text that changes.
- [ ] Mark the criteria with `issues update PMK-224 --check n`, commit `.issues/`.
- [ ] `npm test` in the foreground, exit code 0.
