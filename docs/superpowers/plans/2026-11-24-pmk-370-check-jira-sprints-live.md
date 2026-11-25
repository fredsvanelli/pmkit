# PMK-370 Jira sprint flows live check: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (small task, AGENTS.md). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check the Jira sprint flows on the owner's live site, fix the silent subtask move, and record the results.

**Architecture:** One opt-in live test in `scripts/lib/jira/client-live.mjs` drives the real CLI on the throwaway space and checks Jira's raw answers. `updateIssue` in `scripts/lib/jira/issue-ops.mjs` re-reads the item after an Agile move and refuses a move Jira ignored; the fake ignores a subtask's move as the site does.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-370-check-jira-sprints-live-design.md`

## Global Constraints

- The site host, the email and the token never reach the repository, the PR, the issue or test output (`hostless`, `scrub`, `assertNoSecret`).
- Live writes go to `PMKIT_LIVE_JIRA_SPACE` (Kudos) only; every sprint and work item the run makes is deleted, and any sprint of the board absent before the run.
- The other-board check (AC 4) waits for the owner's answer to Q1; nothing is written outside Kudos until then.
- Test first: a failing test before each behavior change.
- `npm test` and `npm run lint` pass.

## Review Focus

- A move to `none` (backlog) of a done item: its sprint reads the last closed one (ADR 0016), so the new check must not refuse it. Test: Task 1 step 1, third assertion.
- A move to the sprint the item already holds: no write, no check (unchanged path). Covered by the existing `updateIssue` no-op path; Task 1 step 1 asserts a normal move still passes.
- `moveToCycle` over two items where the second is the subtask: the first moved, then `stoppedHalfway` names it. Test: Task 1 step 1, `cycle-ops.test.mjs`.
- A live run that fails halfway leaves sprints: cleanup is in `finally` and deletes every sprint not present before. Task 2.
- Jira's search index trailing a sprint move: `issues list --sprint` is wrapped in `eventually`. Task 2.

---

### Task 1: A move Jira ignores is refused (the subtask case)

**Files:**
- Modify: `scripts/fake-jira-issues.mjs` (`moveIssues`: skip a subtask, `isSubtaskType`)
- Modify: `scripts/lib/jira/issue-ops.mjs` (`updateIssue`, after `moveToSprint`)
- Test: `scripts/lib/jira/issue-ops.test.mjs`, `scripts/lib/jira/cycle-ops.test.mjs`

**Interfaces:**
- Produces: `updateIssue` throws `PmkitError('CONFLICT', ...)` when `plan.sprint.to !== null` and the re-read item's `sprint !== plan.sprint.to`. Message `Jira did not move <key> to sprint <id>`; for a subtask (the item's `fields.issuetype.subtask === true` or `hierarchyLevel === -1`) the message adds `: Jira keeps a subtask in its parent's sprint` and `nextStep` is `pmkit cycle add <parent key> --to <id>`; otherwise `nextStep` is `Check <key> on the sprint board in Jira`.

- [ ] **Step 1: Write the failing tests**

`issue-ops.test.mjs`, `test('updateIssue refuses a sprint move Jira ignores: a subtask stays out, a normal item and a move to none pass')`: with the fake seeded with `SPRINT`, a story P and a subtask S of P (raw `POST /rest/api/3/issue` with issuetype `10003`, parent P):
- `await assert.rejects(tracker.updateIssue(S, { sprint: '1' }, ME), { code: 'CONFLICT', message: /subtask in its parent's sprint/, nextStep: `pmkit cycle add ${P} --to 1` })`
- `(await tracker.updateIssue(P, { sprint: '1' }, ME)).after.sprint === '1'`
- P moved to done, then `updateIssue(P, { sprint: 'none' })` resolves (no refusal).

`cycle-ops.test.mjs`, `test('moveToCycle stops at a subtask Jira does not move and names the items moved')`: `moveToCycle([P, S], '1', ME)` rejects; `error.details` names P as moved (the `stoppedHalfway` shape the file's other halfway test asserts).

- [ ] **Step 2: Run to see them fail**

Run: `node --test scripts/lib/jira/issue-ops.test.mjs scripts/lib/jira/cycle-ops.test.mjs`
Expected: the subtask assertions fail (the fake moves the subtask; `updateIssue` resolves).

- [ ] **Step 3: Fake: `moveIssues` skips a subtask (`isSubtaskType(item)`), as the site answers 204 and changes nothing.** `ponytail:` comment: the site then shows the parent's sprint on the subtask; the fake leaves it empty.

- [ ] **Step 4: `updateIssue`: after `moveToSprint`, read `afterOf` once, apply the check above, return that read.**

- [ ] **Step 5: Run the two files, then `npm test`**

Expected: PASS.

- [ ] **Step 6: Commit** `fix: refuse a Jira sprint move that Jira ignores, as for a subtask (PMK-370)`

### Task 2: The live sprint-flow test, run on Kudos

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment line for PMK-370; new test after the issue flows)

**Interfaces:**
- Consumes: `liveRepo`, `INIT`, `acceptAll`, `eventually`, `removeAll`, `client`, `discoverSpace`, `buildJiraCapabilities` (already in the file); Task 1's `CONFLICT`.

- [ ] **Step 1: Write `test('sprint flows on the throwaway space', { skip: NEEDS_SPACE })`** with the design's steps 1 to 10. Skips when `cycles` is not `native`. Values: `today` is the UTC date; first sprint `--start today --name "pmkit-live <run>" --goal <run>`, end today + 13; second `--start today+14`. Raw checks: `startDate`/`endDate` equal `${date}T12:00:00.000Z`; `originBoardId` the board; Sprint changelog item `fieldId` the mapped sprint field, `from` `''` or null, `to` the id; after close A's Sprint field holds only the closed sprint and A is in `GET /board/{id}/backlog`; `issues list --sprint none` lists A not B; `issues get B` `sprint` the closed id. Subtask: raw P and S (`issuetype` the space's subtask-level type), `cycle add S --to <first>` exits non-zero with `CONFLICT` (the test's `cli` asserts exit 0, so this one call uses `spawnSync` directly and checks the JSON error). Cleanup in `finally`: `removeAll`, then `DELETE /rest/agile/1.0/sprint/{id}` for each board sprint not in the before list, then assert none left.

- [ ] **Step 2: Run without `PMKIT_LIVE`**: `node --test scripts/lib/jira/client-live.mjs`. Expected: every test skipped with its reason.

- [ ] **Step 3: Run live** (env loaded from the git-ignored settings file at runtime): `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=KAN node --test scripts/lib/jira/client-live.mjs`. Expected: pass; Kudos has no sprint and no work item after (raw check). A failing step: debug (systematic-debugging), fix test-first, rerun.

- [ ] **Step 4: Commit** `test: live check of the Jira sprint flows (PMK-370)`

### Task 3 (C Check): runbook, ADR line, results

**Files:**
- Modify: `docs/runbooks/cycles-jira.md` (live-check line; "Before you start" note: a REST close leaves unfinished items in the closed sprint; time-zone limit; new step: `cycle add <subtask> --to 1` gives `CONFLICT` with the parent's `cycle add` next step)
- Modify: `scripts/runbook-cycles-jira.test.mjs` (the new step: the test adds a Sub-task of `ENG-1` to the fake's saved state, as Jira holds one made in its UI, then runs the command)
- Modify: `docs/adr/0016-jira-issue-sprint-is-its-open-sprint-else-its-last-closed-one.md` (consequence: a REST close leaves unfinished items in the closed sprint, checked live 2026-11-24)
- Modify: the design doc (a `## Result` table per AC: pass, fail-then-fixed, skipped with reason)

- [ ] **Step 1: Add the runbook step and its test step; run** `node --test scripts/runbook-cycles-jira.test.mjs` — the new step fails before the runbook text matches, passes after.
- [ ] **Step 2: Run every Jira runbook test**: `node --test scripts/runbook-*jira*.test.mjs`. Expected: PASS.
- [ ] **Step 3: ADR line, design `## Result`, commit** `docs: PMK-370 live results in the cycles runbook and ADR 0016 (PMK-370)`

### Task 4 (held): the other-board check

Only if the owner says yes to Q1: a saved filter `project = KAN` and a Scrum board on it (location the token user), a sprint of it holding a Kudos item; check `cycle list` leaves it out, `issues get` reads no sprint, `cycle add <item> --to <its id>` is refused; delete the sprint, the board and the filter, and check them gone. A one-off probe recorded in the design's Result unless the owner wants it in the live test. If the answer is no: AC 4 is recorded as skipped and left open in the PR.
