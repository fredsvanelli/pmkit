# PMK-162 Plan Blocker In Planned Sprint Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cycle-plan scenario runs step 5's rule for a blocker already in the chosen planned sprint.

**Architecture:** `scripts/__scenarios__/cycle-plan.mjs` exports two scenarios; the new one sets up the planned sprint and the blocker with the CLI.

**Tech Stack:** The scenario harness, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-162-plan-blocker-in-planned-sprint-scenario-design.md`

## Global Constraints

- Scenario 0 unchanged; its snapshot is renamed to `cycle-plan.0.after.txt`.

## Review Focus

- Step 1 confirmed; no `cycle open` in scenario 1; `cycle capacity` on the existing sprint.

---

### Task 1

- [ ] Scenario 1 (setup, steps, `expect`); rename the snapshot; `UPDATE_GOLDENS=1`; run `node --test scripts/scenarios.test.mjs`: green.
- [ ] Mutation: flip `expect` to want ISS-6J0B left out; run: red. Revert.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
