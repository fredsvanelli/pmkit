# prioritize-by-demand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/pmkit:backlog:prioritize-by-demand`, which ranks open issues by demand and changes priorities after a full preview.

**Architecture:** A command file only. It composes existing CLI calls (`capabilities`, `demand list`, `issues list`, `issues get --comments`, `issues update --priority`). No CLI or capability change.

**Tech Stack:** Markdown command file, node:test scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-07-prioritize-by-demand-design.md`

## Global Constraints

- Every call ends with `--json`; every flag exists in the CLI (scenarios Rule 3, 4).
- A command file with a write call declares a confirmation point (Rule 13).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in each message.
- A missing signal is never a zero score; a failed batch write stops and lists applied and remaining.

## Review Focus

- A candidate whose `issues get` fails: marked not verified, not ranked, not written (command text states it).
- `demand list` returns signals only for issues outside the candidates: falls back to comments and mentions and says so.
- All proposed priorities equal the current ones: nothing to write, stop.
- Linear (`demand_signals` absent): fallback mode, says so.
- More than 30 candidates in fallback mode: the rest are listed as not ranked.

---

### Task 1: Command file and scenario

**Files:**
- Create: `commands/backlog/prioritize-by-demand.md`
- Create: `scripts/__scenarios__/backlog-prioritize-by-demand.mjs` (+ generated `.after.txt`)
- Modify: `scripts/scenarios.test.mjs` (file count 49 → 50), `scripts/plugin.test.mjs` (`backlog` list), `scripts/scenarios-live.mjs` (`LIVE_EXPECT_STOPS`)

**Interfaces:**
- Consumes: CLI calls named in Architecture.
- Produces: scenario named `backlog/prioritize-by-demand`.

- [ ] **Step 1: Update counts and COMMANDS list; run `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs`, expect FAIL (no command file / scenario).**
- [ ] **Step 2: Write the command file; write the scenario on the `team` fixture: setup files accepted requests with `requests create --issue`; assert the priorities written and one event per changed issue.**
- [ ] **Step 3: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read the snapshot diff, rerun both test files, expect PASS.**
- [ ] **Step 4: Commit `feat(backlog): add prioritize-by-demand command (PMK-68)`.**

### Task 2: Registry and criteria

**Files:** Modify `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`, `.issues/issues/PMK-68/`.

- [ ] **Step 1: Add the README bullet, SKILL.md table row, and CHANGELOG line at the top of `## Unreleased`.**
- [ ] **Step 2: Run the full suite by the machine baseline rule.**
- [ ] **Step 3: Tick criteria 1 to 3 with `issues update PMK-68 --check n`, commit `.issues/`, open PR, comment, move to `in_review`.**
