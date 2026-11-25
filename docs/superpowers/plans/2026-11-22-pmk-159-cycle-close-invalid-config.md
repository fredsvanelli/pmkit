# PMK-159 Cycle Close Invalid Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pmkit:cycle:close` on an invalid `.pmkit/config.yaml` is a report only, said once in "If something is missing".

**Architecture:** Command-file text; one static test; a second cycle-close scenario.

**Tech Stack:** Markdown, the scenario harness, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-159-cycle-close-invalid-config-design.md`

## Global Constraints

- Step ids unchanged. The first scenario's snapshot is renamed `cycle-close.0.after.txt`.

## Review Focus

- No write call in the invalid-config scenario after step 1's failed dry run.

---

### Task 1

- [ ] Static test: step 1 points to "An invalid `.pmkit/config.yaml`"; the bullet skips step 6 and shows the report without a question. Run: red.
- [ ] Scenario `invalidConfig`: setup sets `confirm: maybe`; step 1 dry run `expectError: 'INVALID_INPUT'`; steps 2 to 5 read; `expect` checks the sprint is active and ISS-8C4W unchanged. Rename the snapshot; `UPDATE_GOLDENS=1`.
- [ ] Edit step 1 and the bullet; run: green.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
