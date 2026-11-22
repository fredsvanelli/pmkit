# PMK-152 Sprint None And Unknown In Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `createIssue`, `updateIssue` and `moveToCycle` refuse an unknown sprint ID and the string `none` with `INVALID_INPUT` on Local, Linear and GitHub, and the spec and the contract suite say so.

**Architecture:** One contract case; Local `moveToCycle` uses `requireSprint`; Linear `cycleNodeFor` throws `unknownSprint`; GitHub `moveTarget` throws `INVALID_INPUT`.

**Tech Stack:** Node 18+, `node:test`, the Linear and GitHub fakes.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-152-sprint-none-and-unknown-in-writes-design.md`

## Global Constraints

- Next step `pmkit cycle list`. `null` stays "no sprint" in every write. Subject reads (`cycleIssues`, `getCapacity`) keep `NOT_FOUND`.

## Review Focus

- A refused move writes nothing, even for the first issue of the list.
- `current` with no active sprint keeps its own `INVALID_INPUT` message.
- Linear with cycles off: a sprint write stays `NOT_SUPPORTED`.

---

### Task 1: Contract case (red)

- [ ] `scripts/contract-suite.mjs`, `cycles`: `a sprint value no sprint has, or none, fails with INVALID_INPUT in createIssue, updateIssue and moveToCycle and writes nothing` (values `unknownSprintLike(active.id)` when not null, and `none`; `issueState` unchanged after each).
- [ ] Run the three contract test files: red on Local and Linear and GitHub `moveToCycle`, Linear create/update.

### Task 2: Adapters (green)

- [ ] Local `moveToCycle`: `const sprint = to === null ? null : requireSprint(to)`.
- [ ] Linear `cycleNodeFor`: `missing` is `unknownSprint(sprint)`; the PMK-153 search check calls it without the catch.
- [ ] GitHub `moveTarget`: `throw invalid(\`sprint ${to} does not exist\`, 'pmkit cycle list')` for an unknown date.
- [ ] Update adapter unit tests that asserted `NOT_FOUND` for a move or write target.

### Task 3: Docs and checks

- [ ] Spec Cycles row and contract paragraph; `commands/issues/bulk.md` `NOT_FOUND` bullet; CHANGELOG; `npm test`, `npm run lint`; commit.
