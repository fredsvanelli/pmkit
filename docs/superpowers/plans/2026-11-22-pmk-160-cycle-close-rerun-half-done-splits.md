# PMK-160 Cycle Close Rerun Half-Done Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second run of `/pmkit:cycle:close` finds and finishes a split whose link or whose move to `done` failed.

**Architecture:** The split's create writes a marker description; step 6 searches for it; finishing a split skips an estimate update already made. Command-file text, static tests, a third scenario.

**Tech Stack:** Markdown, the scenario harness, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-160-cycle-close-rerun-half-done-splits-design.md`

## Global Constraints

- Marker line: `Remaining work of <original id>, split when sprint <sprint id> closed.`; search text: `split when sprint <sprint id> closed`.

## Review Focus

- No second create for a split found by its marker.
- The estimate update runs only when the delivered part differs from the current estimate.

---

### Task 1: Tests (red)

- [ ] Static: step 7's create carries `--description-file`; step 6 runs `issues list --text "split when sprint <sprint id> closed"`; step 8 runs the estimate update of a split to finish only when it changes the estimate.
- [ ] Scenario 0: the create gains `--description-file` with the marker (input file under `_inputs/`).
- [ ] Scenario `finishHalfDoneSplit`: setup leaves the half-done split; the steps finish it; `expect` checks one remaining-work issue, links, sub-issue, estimate 5, `done`.

### Task 2: close.md (green), checks

- [ ] Steps 6, 7, 8; `UPDATE_GOLDENS=1`; CHANGELOG; `npm test`; `npm run lint`; commit.
