# PMK-234 Guard the prioritize-by-demand write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, chosen by the coordinator) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/pmkit:backlog:prioritize-by-demand` refuses a write from a stale preview and has a ranking-only mode that proposes nothing.

**Architecture:** Markdown command file plus scenario. Step 6 keeps each dry run's `before`; step 8 re-runs the dry runs and compares before the first write. A bare `rank-only` argument stops after the ranking table. No CLI change.

**Tech Stack:** Node `node:test` scenarios (`scripts/scenarios.test.mjs`), command files in `commands/`.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-234-prioritize-by-demand-guard-design.md`

## Global Constraints

- Every commit message carries `(PMK-234)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A read that is incomplete or fails is "not verified": never "nothing changed", never a write.
- The scenario suite's rule 3: no loose `--flag` in prose that no CLI command takes, so the mode is the word `rank-only`.
- Goldens come from `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, never by hand.
- `npm test` runs in the foreground and must exit 0.

## Review Focus

- The preview's priority changes between the dry run and the write: nothing is written and the command restarts at step 2.
- The re-check dry run itself fails: not verified, nothing written.
- `rank-only` together with an incomplete read: ranking shown as incomplete, still nothing written, no question.
- `rank-only` with no candidate or no score above 0: says so and stops, no proposal.
- `rank-only` is not passed to `issues list` as a filter flag.

---

### Task 1: Stale-write guard

**Files:**
- Modify: `commands/backlog/prioritize-by-demand.md` (steps 6, 8, Confirmation points, Output)
- Modify: `scripts/__scenarios__/backlog-prioritize-by-demand.mjs`, regenerated `backlog-prioritize-by-demand.*.after.txt`

**Interfaces:** Produces the re-check: the same `issues update <id> --priority <p> --dry-run --json` calls of step 6, run again at the start of step 8.

- [ ] **Step 1: Failing scenario.** New entry "stale preview": requests make ISS-6J0B urgent and ISS-3F7H high; after `{ confirm: 'Step 7' }` an `edit` of `.issues/issues/ISS-3F7H/issue.md` changes its priority; the re-check dry run of ISS-3F7H shows a `before` unlike the previewed one. `expect` asserts `repo.newEvents('ISS-6J0B').length === 0` and ISS-3F7H keeps the edited priority. Existing write entries get the re-check dry runs (same args as step 6) after `Step 7` and before their writes.
- [ ] **Step 2:** `node --test scripts/scenarios.test.mjs` fails.
- [ ] **Step 3: Command file.** Step 6 keeps each `before`. Step 8 first re-runs every step 6 dry run and compares `before` (with `updated`). On any difference or failure: write nothing, list each changed issue as previewed → now, go back to step 2. Say the known ceiling (no compare-and-set on `issues update`). Update Confirmation points (step 7 is asked again after a restart) and Output.
- [ ] **Step 4:** regenerate goldens, read the diff, scenario tests pass.
- [ ] **Step 5: Commit** `feat(backlog): stop prioritize-by-demand from writing a stale preview (PMK-234)`.

### Task 2: Ranking-only mode

**Files:**
- Modify: `commands/backlog/prioritize-by-demand.md` (frontmatter `argument-hint`, Parameters, step 2, step 5, Output)
- Modify: the scenario file and goldens

**Interfaces:** Consumes the ranking of step 5. Produces a stop after the table; no `issues update` call.

- [ ] **Step 1: Failing scenario.** Entry "rank-only": `answers: []`, `steps: reads`, `notHit` Step 5 and Step 7, `skip` steps 6 and 9 with a reason; `expect` asserts no new events on any of the four candidates.
- [ ] **Step 2:** scenario test fails.
- [ ] **Step 3: Command file.** Parameters: `rank-only` (optional first word, removed before the find flags are read). Step 5: with `rank-only`, show the table without the proposed priority, bands, cap or question, say "ranking only: nothing proposed, nothing written" and stop. Incomplete reads and not verified issues are shown as in the normal run.
- [ ] **Step 4:** regenerate goldens, tests pass.
- [ ] **Step 5: Commit** `feat(backlog): add a ranking-only mode to prioritize-by-demand (PMK-234)`.

### Task 3: Docs, criteria and verification

**Files:** `CHANGELOG.md` (top of `## Unreleased`), `README.md` and `skills/pmkit/SKILL.md` description lines, `scripts/scenarios-live.mjs` only if `LIVE_EXPECT_STOPS` needs the new entries, `.issues/` for criteria.

- [ ] **Step 1:** CHANGELOG line in the style of the PMK-204 line; README and SKILL.md lines mention the ranking-only mode.
- [ ] **Step 2:** `node --test scripts/scenarios.test.mjs scripts/plugin.test.mjs` pass.
- [ ] **Step 3:** `npm test` in the foreground, exit code 0 (`echo $?`).
- [ ] **Step 4:** `issues update PMK-234 --check 1` and `--check 2`, dry run then real; commit `.issues/`.
- [ ] **Step 5:** open the PR with `pr open`, summary comment, move to `in_review`.
