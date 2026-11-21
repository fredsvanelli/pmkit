# Clean up an interrupted live check run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SIGINT or SIGTERM during a writing live check runs its cleanup, prints what it removed and what it could not (with a URL and the runbook step), and exits 130 or 143.

**Architecture:** `withCleanup` registers a run-once cleanup in a module-level set of `live-checks.mjs`; `cleanUpPending(write)` runs the pending ones. `client-live.mjs` installs SIGINT and SIGTERM handlers that switch the check's writer to stderr, run `cleanUpPending`, and exit.

**Tech Stack:** Node 18+ ES modules, `node:test`, the live fake `gh` (`scripts/fake-gh-live.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-349-live-checks-cleanup-on-interrupt-design.md`

## Global Constraints

- The run command in the runbook becomes `node scripts/lib/github/client-live.mjs` (plain `node`, not `node --test`). Checked in a scratch probe on 2026-11-21: under `node --test` the runner exits on Ctrl-C and leaves the file's process cleaning up with no output to write to. Under plain `node` the handler runs, prints and exits 130. This is the ruling the design left to this plan.
- A second signal during the cleanup is ignored (the handlers stay installed and a flag stops re-entry); the cleanup runs once even when the check's own `withCleanup` reaches it too.
- Failure lines name a URL and the runbook step: a draft, the Project URL with the item id (step 1); the iterations, the Project's settings URL (step 2); the GHES issue, its URL (step 3).
- After an interrupted cleanup, one more line: check the Project for drafts titled `pmkit-live` (step 1), for a draft whose add was in flight.

## Review Focus

- The signal arrives while the check's own cleanup already runs: one cleanup, not two (Task 1 test).
- The signal arrives before any write: nothing is pending, the run exits 130 with no cleanup line but the closing one (Task 2 E2E covers the in-flight case only; Task 1 covers the empty registry).

---

### Task 1: the registry and the cleanup lines

**Files:** Modify `scripts/lib/github/live-checks.mjs` (`LIVE_DOCUMENTS.PROJECT` reads `url`; `preflightProject` returns it; `cleanUp` steps carry a hint; `withCleanup` registers; `cleanUpPending`). Test: `scripts/lib/github/live-checks.test.mjs`.

**Interfaces:** Produces `cleanUpPending(write: (line: string) => void): Promise<string[]>` (the failure lines) and `INTERRUPTED_STEP` (the closing line text).

- [ ] **Step 1: Write the failing tests.**
  - `cleanUpPending during the openCycle check deletes its drafts and restores the iterations, once`: a `makeExec` that, on the `PmkitUpdateIterations` of `openCycle` (the first one), awaits `cleanUpPending(lines.push)` and then throws; expect `projectItems(github)` empty, `iterationIds(github)` `['IT_0', 'IT_1']`, lines include `deleted the draft PVTI_1` and `restored the 2 iterations of the field Sprint`, and exactly one restoring `PmkitUpdateIterations` after the interrupted one.
  - `a cleanup step that fails prints the URL and the runbook step`: `github.failNext('PmkitDeleteProjectItem')` and interrupt as above; a line matches `cleanup failed, deleting the draft PVTI_1: .*; remove it by hand at https://github.com/orgs/acme/projects/7 \(item PVTI_1\), as "Clean up after a stopped run" step 1 says`.
  - `cleanUpPending with nothing pending writes nothing and returns []`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/live-checks.test.mjs`: FAIL (no export).
- [ ] **Step 3: Implement.** The pending set holds `{ run }` where `run` is the cleanup wrapped to return one shared promise; `withCleanup` adds it before the body and removes it after `run()`.
- [ ] **Step 4: Run** the file: PASS. **Commit** `feat: an interrupted live check can run its pending cleanup (PMK-349)`.

### Task 2: the signal handlers, the runbook, E2E

**Files:** Modify `scripts/lib/github/client-live.mjs`, `scripts/fake-gh-live.mjs` (pause hook: when the fixture's `pauseOn` names the operation, write `<bin>/paused` and wait up to 30 s), `docs/runbooks/live-checks-github.md` (the run command, "Clean up after a stopped run"), `scripts/runbook-live-checks-github.test.mjs`.

- [ ] **Step 1: Write the failing E2E test** `runbook: Ctrl-C during the openCycle check cleans up and exits 130`: fixture with `pauseOn: 'PmkitUpdateIterations'`; spawn `node scripts/lib/github/client-live.mjs` detached with the github.com variables; when `<bin>/paused` exists, `process.kill(-pid, 'SIGINT')`; expect exit code 130, stderr has `deleted the draft` and `restored the 2 iterations of the field Sprint` and the closing line; the fixture's Project has no item and its iterations `IT_0`, `IT_1`. Update `runChecks` to spawn `node <ENTRY>` (plain) and the "names the commands" test to expect `node ${ENTRY}`.
- [ ] **Step 2: Run** `node --test scripts/runbook-live-checks-github.test.mjs`: FAIL.
- [ ] **Step 3: Implement** the handlers in `client-live.mjs` (writer switch, guard flag, `cleanUpPending`, closing line, `process.exit(130|143)`), the pause hook, and the runbook text.
- [ ] **Step 4: Run** the file, `npm test`, `npm run lint`: PASS. **Commit** `feat: Ctrl-C during a writing live check cleans up and says what is left (PMK-349)`.
