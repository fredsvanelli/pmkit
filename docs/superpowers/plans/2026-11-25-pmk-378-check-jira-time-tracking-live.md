# PMK-378 Live Time Tracking Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle PMK-80's fake-only assumptions about Jira worklogs on the live site, fix what differs, and leave an opt-in live test.

**Architecture:** One drop in `history.mjs` (`WorklogTimeSpent`), the fake's worklog `POST` writes the `timeestimate` item the site writes, and one more opt-in test in `scripts/lib/jira/client-live.mjs` that runs the real CLI on the throwaway space.

**Tech Stack:** Node 18+, ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-pmk-378-check-jira-time-tracking-live-design.md`

## Global Constraints

- The host, the email and the token never reach the repository, the PR, the issue or test output (`scrub`, `hostless`, `assertNoSecret`).
- Live writes go to the throwaway space only; everything created is deleted in `finally`.
- Time tracking off (live steps 8 and 9, AC 4 and 6) waits for the owner's answer to Q1; until then the live test does not touch the site setting.
- Every commit message carries `(PMK-378)`.

## Review Focus

- A worklog deleted in Jira: history shows no `jira:WorklogTimeSpent` (Task 1).
- A worklog edited in Jira: no new item kind, the `log_time` event shows the new minutes (Task 3, live).
- More than 20 worklogs: `events` (metricEvents) reads them all (Task 3, live).
- The live run interrupted midway: `finally` deletes the work item (Task 3).
- `timeestimate` updates shown in history are not mistaken for logged time (Task 2 runbook note).

---

### Task 1: Drop `WorklogTimeSpent` from the events (AC 5)

**Files:** Modify `scripts/lib/jira/history.mjs:12`; Test `scripts/lib/jira/history.test.mjs`

- [ ] **Step 1: Failing test** `a deleted worklog's WorklogTimeSpent item is no event either (PMK-378)`: `toEvents(ITEM, [history([timespent 7200→5400, timeestimate 0→1800, { field: 'WorklogTimeSpent', from: '1800', fromString: '1800', to: null, toString: null }, { field: 'WorklogId', from: '10001', to: null }])], ctx)` has no event whose field starts with `jira:Worklog` or `jira:timespent`, and keeps the one `jira:timeestimate`.
- [ ] **Step 2:** `node --test scripts/lib/jira/history.test.mjs` fails on `jira:WorklogTimeSpent`.
- [ ] **Step 3:** `WORKLOG_ITEMS = ['timespent', 'WorklogId', 'WorklogTimeSpent']`.
- [ ] **Step 4:** the test passes.
- [ ] **Step 5:** commit `fix: drop the WorklogTimeSpent item a deleted Jira worklog writes (PMK-378)`.

### Task 2: The fake writes `timeestimate` with each worklog; runbook notes it (AC 3, Q2)

**Files:** Modify `scripts/fake-jira-issues.mjs` (worklog `POST`), `scripts/runbook-time-jira.test.mjs` step 5, `docs/runbooks/time-jira.md` step 5; Test `scripts/runbook-time-jira.test.mjs`

- [ ] **Step 1: Failing test** in the runbook test, step 5: `history.filter((e) => e.field === 'jira:timeestimate').map((e) => [e.from, e.to])` deep-equals `[[null, '0'], ['0', '0']]`, and no field starts with `jira:Worklog`.
- [ ] **Step 2:** `node --test scripts/runbook-time-jira.test.mjs` fails.
- [ ] **Step 3:** the fake's worklog `POST` records `{ field: 'timeestimate', fieldId: 'timeestimate', fieldtype: 'jira', from, to: '0' }` (from `null` on the first worklog, `'0'` after; strings as the live site sends) between `WorklogId` and `timespent`, the site's order.
- [ ] **Step 4:** the test and `scripts/lib/jira/*.test.mjs` pass.
- [ ] **Step 5:** runbook step 5: expect the two `jira:timeestimate` updates (Jira's remaining estimate, auto-adjusted; no time counted twice) and note a worklog edited or deleted in Jira adds no `jira:` update. Commit `test: write the remaining estimate change with each fake Jira worklog, as the site does (PMK-378)`.

### Task 3: Live test in `client-live.mjs`

**Files:** Modify `scripts/lib/jira/client-live.mjs` (header comment + new test at the end)

`test('time tracking flows on the throwaway space', { skip: NEEDS_SPACE })`, design steps 1-7 and 10; steps 8-9 behind the owner's Q1 answer. Uses `liveRepo`, `INIT`, `acceptAll`, `eventually`, `removeAll`, `worklogsOf`-style raw paging through `jira.paginate`.

- [ ] **Step 1:** skip with a reason when raw `GET /configuration` has `timeTrackingEnabled` false.
- [ ] **Step 2:** write steps 2-7 per the design; minutes and counts exactly as the design states (90, 45, 22 worklogs, total 155, one edited to 1800 s, one deleted → 21 `log_time` events, one of 30).
- [ ] **Step 3:** run `PMKIT_LIVE=1 ... node --test scripts/lib/jira/client-live.mjs --test-name-pattern "time tracking"`: before Task 1 it fails on `jira:WorklogTimeSpent` (verify by reverting Task 1 locally once, or by order of commits), after it passes; Kudos empty afterwards.
- [ ] **Step 4:** commit `test: check the Jira time tracking flows live (PMK-378)`.
- [ ] **Step 5 (after Q1):** add steps 8-9 with the setting restored in `finally`, or record AC 4/6 as skipped.

### Task 4: Record the result

- [ ] Runbook live-check line, design "Result" section, issue criteria ticked; full live suite rerun (`client-live.mjs`, all tests). Commit `chore: record the PMK-378 live result (PMK-378)`.
