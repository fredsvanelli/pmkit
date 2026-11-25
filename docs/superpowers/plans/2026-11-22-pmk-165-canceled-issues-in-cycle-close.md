# PMK-165 Canceled Issues In Cycle Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:cycle:close` reads a canceled issue as `closeCycle` does, and step 6's question names `AskUserQuestion`.

**Architecture:** Command-file text, two static tests, one scenario setup change.

**Tech Stack:** Markdown, `node:test`, the scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-165-canceled-issues-in-cycle-close-design.md`

## Global Constraints

- No CLI change. Step ids of `close.md` unchanged.

## Review Focus

- The canceled issue in the scenario gets no `cycle add` and keeps its sprint after the close.

---

### Task 1

- [ ] Static tests: step 3 names `canceled` as left out of the unfinished issues; step 6's question names `AskUserQuestion`. Run: red.
- [ ] Scenario: setup creates `Drop the legacy export` in the active sprint and moves it to `canceled`; `expect` checks its sprint and status after the close and that no `cycle add` names it. Run: snapshot differs only by the new issue.
- [ ] Edit steps 3, 4 and 6; run: green; `UPDATE_GOLDENS=1` for the snapshot.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
