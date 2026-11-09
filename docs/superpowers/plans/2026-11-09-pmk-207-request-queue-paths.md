# PMK-207 Request Queue Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the failed-dry-run rule and the customer-ID rule of `commands/backlog/request-queue.md`, and add scenarios that reach them and the triage suggestion.

**Architecture:** Text change in the command file; scenario entries in `scripts/__scenarios__/backlog-request-queue.mjs`; snapshots regenerated with `UPDATE_GOLDENS=1`.

**Tech Stack:** Node test runner, pmkit scenario harness.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-207-request-queue-paths-design.md`

## Global Constraints

- Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in each message.
- Never edit `*.after.txt` by hand. Never run the CLI inside `scripts/__fixtures__/`.
- `CHANGELOG.md` line under `## Unreleased`, at the top.
- No new command file, so no README/SKILL/count changes.

## Review Focus

- Every request in the queue fails its create dry run: nothing is left, the command says nothing would change and stops (existing step 5 rule; the scenario's other entry keeps one request alive).
- Customer file missing AND `from` present: the `from` text wins over the ID.

### Task 1: Command text

**Files:** Modify `commands/backlog/request-queue.md` (steps 4 and 5.1).

- [ ] Step 4: "who asked" becomes: the customer name when known, otherwise the `from` text, otherwise the customer ID when the request has one, never a guessed name.
- [ ] Step 5.1: add: a failed dry run (for example `INVALID_INPUT`) drops that decision and says why with `error.message` and `error.nextStep`; the request stays open and the others go on.

### Task 2: Scenarios

**Files:** Modify `scripts/__scenarios__/backlog-request-queue.mjs`; create `scripts/__scenarios__/_inputs/request-queue-empty-title.md` (empty).

- [ ] Write entry "Linear, no request queue": `linear: {}`, `git: true`, Linear config as in `issues-run-view.mjs`, steps `[{ step: '1', read: ['capabilities'], save: 'capabilities' }]`, expect `request_queue.path === 'absent'` and only `capabilities` called. Run `node --test scripts/scenarios.test.mjs`, expect fail on missing snapshot.
- [ ] Write entry "failed dry run and unknown customer": two requests (one with `--customer CUS-ZZZZ`, no `from`; one whose create dry run uses the empty title file with `expectError: 'INVALID_INPUT'`). Assert the created issue description contains `Asked by: CUS-ZZZZ.` and the failed request stays `state: open`.
- [ ] Regenerate: `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, read `git diff scripts/__scenarios__/`.
- [ ] Commit.

### Task 3: Docs, issue and verification

- [ ] CHANGELOG line; tick criteria 1-3 with `issues update PMK-207 --check n` (dry run, then real); commit `.issues/`.
- [ ] `npm test` in foreground, exit code 0.
