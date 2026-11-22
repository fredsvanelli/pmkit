# PMK-166 Refuse Closed Sprint And Check Closed Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A write into a closed sprint is `CONFLICT` on every tracker, and velocity survives an unparsable `closed`.

**Architecture:** `closedSprint(id)` in `issue-filter.mjs`; the three trackers' sprint resolvers throw it; `velocity` checks `Date.parse(closed)`.

**Tech Stack:** Node 18+, `node:test`, the Linear and GitHub fakes.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-166-refuse-closed-sprint-and-check-closed-time-design.md`

## Global Constraints

- `CONFLICT`, message `sprint <id> is closed`, next step `pmkit cycle list --state planned`. `null` (out of a sprint) is never refused.

## Review Focus

- `/pmkit:cycle:close` writes before the close: unchanged.
- A dry run into a closed sprint fails the same way and writes nothing.
- `velocity` with a valid `closed` behaves as before (PMK-121 tests).

---

### Task 1: Tests (red)

- [ ] Contract, `cycle-lifecycle`: open a sprint today, close it, then `createIssue`, `updateIssue`, `moveToCycle` (and `moveToCycle` with `{ dryRun: true }`) into it reject `CONFLICT`; `issueState` unchanged.
- [ ] Linear `cycle-ops.test.mjs`: a past cycle as target of `moveToCycle` and `updateIssue` is `CONFLICT`, no mutation.
- [ ] GitHub `cycle-ops.test.mjs`: a completed iteration as target is `CONFLICT`, no mutation.
- [ ] `velocity` test: `closed: 'not a time'` counts by `end`.

### Task 2: Code (green), docs, checks

- [ ] `closedSprint`; Local `requireSprint`; Linear `cycleNodeFor`; GitHub `iterationOf`, `moveTarget`; `velocity`.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
