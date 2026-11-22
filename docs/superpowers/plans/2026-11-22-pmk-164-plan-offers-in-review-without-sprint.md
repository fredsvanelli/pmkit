# PMK-164 Plan Offers In Review Without Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:cycle:plan` step 5 offers sprintless `in_review` issues, and close step 6 says so.

**Architecture:** Command-file text; the PMK-122 static test and the cycle-plan scenario follow.

**Tech Stack:** Markdown, `node:test`, the scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-164-plan-offers-in-review-without-sprint-design.md`

## Global Constraints

- `done`, `canceled` and `triage` stay out of step 5.

## Review Focus

- Both step 5 calls (plain and `--blocked`) take the same categories.

---

### Task 1

- [ ] Static test: step 5 reads `in_review` (moved from the left-out list); the `--blocked` call too. Run: red.
- [ ] Scenario: setup creates `Review the retry policy` (estimate 2), moves it to `in_review`; step 5 calls take `todo,backlog,in_progress,in_review`; `expect` lists it last in the scope and in the new sprint. Run: red.
- [ ] Edit plan step 5 and close step 6; `UPDATE_GOLDENS=1`; run: green.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
