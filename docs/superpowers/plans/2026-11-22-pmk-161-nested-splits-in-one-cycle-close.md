# PMK-161 Nested Splits In One Cycle Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nested splits in one `/pmkit:cycle:close` leave remaining work pointing to remaining work.

**Architecture:** Command-file rule and write order; one static test; a fourth cycle-close scenario.

**Tech Stack:** Markdown, the scenario harness, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-161-nested-splits-in-one-cycle-close-design.md`

## Global Constraints

- The PMK-123 static tests keep holding: related before blocks and parent, both before the move.

## Review Focus

- ISS-2X6D′ blocked by ISS-5N1R′, not ISS-5N1R; ISS-4M2S stays under ISS-2X6D; ISS-4M2S′ under ISS-2X6D′.

---

### Task 1

- [ ] Static test: step 8 lists every create before the first link; step 7 states the rule for a split blocker and a split sub-issue. Run: red.
- [ ] Scenario `nestedSplits` with its input files; run: red until close.md is edited (snapshot).
- [ ] Edit steps 7 and 8; `UPDATE_GOLDENS=1`; CHANGELOG; `npm test`; `npm run lint`; commit.
