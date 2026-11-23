# PMK-80 Jira Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `logTime` and `listTimeEntries` on the Jira tracker write and read Jira worklogs, and worklogs show as `log_time` events in history and metrics.

**Architecture:** A pure `scripts/lib/jira/worklogs.mjs` maps worklogs to time entries and events; a pure `scripts/lib/time-entries.mjs` holds the summing shared with the Local tracker; `scripts/lib/jira/time-ops.mjs` holds the two operations; `history-ops.mjs` joins worklogs into the events. The stateful fake gains worklogs.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md`

## Global Constraints

- No new dependency; `npm test` and `npm run lint` pass.
- Every commit message names `PMK-80`.
- Entry `at` = worklog `started` via `jiraTime`; `by` = `author.accountId`; `minutes` = `Math.round(timeSpentSeconds / 60)`; an entry rounding to 0 or with no `timeSpentSeconds` is ignored and counted in `ignored`.
- Write: `POST /rest/api/3/issue/{key}/worklog` with `{ timeSpentSeconds: minutes * 60, started }`, `started` in Jira format `2026-11-22T12:00:00.000+0000` from `now()`.
- Absent `time_tracking`: `logTime` and `listTimeEntries` throw `NOT_SUPPORTED` with the manifest's `enableHint`, "Turn on time tracking in Jira's global settings".
- Invalid minutes: `INVALID_INPUT`, `minutes must be a positive integer`.
- A dry run sends no write.

## Review Focus

- A worklog list longer than one page (Jira pages at 5000, the `worklog` field carries 20): history and metrics read `/worklog` when `worklog.total` exceeds what the item carries. Test in Task 4.
- An entry dated outside every sprint, or a future sprint with no dates: counted as `sprint: null`, never thrown. Test in Task 1.
- A worklog of 90 seconds (1.5 min) rounds to 2; one of 20 seconds is ignored. Test in Task 2.
- A changelog with `timespent` and `WorklogId` items: no `jira:timespent` event, so time is not counted twice. Test in Task 2.
- `--as` another member: the viewer check refuses before any write. Test in Task 4.

---

### Task 1: Shared time-entry summing

**Files:**
- Create: `scripts/lib/time-entries.mjs`, `scripts/lib/time-entries.test.mjs`
- Modify: `scripts/lib/local/tracker.mjs` (`listTimeEntries`, about lines 1231-1268)

**Interfaces:**
- Produces: `summarizeTimeEntries({ issue, entries, sprints, ignored }) -> { issue, entries, total, totalTime, byPerson, bySprint, ignored }`. `entries`: `[{ at, by, minutes }]`, all valid. `sprints`: `[{ id, start, end }]` (start/end `YYYY-MM-DD` or null), any order. Output entries are `{ at, by, minutes, time }` in input order; `bySprint` rows `{ sprint, minutes, time }` with `sprint: null` for none.

- [ ] **Step 1: Failing tests** in `time-entries.test.mjs`:
  - two entries by `a` (45, at `2026-11-03T10:00:00Z`) and `b` (90, at `2026-11-20T23:30:00-03:00`), sprints `[{id:'2',start:'2026-11-15',end:'2026-11-28'},{id:'1',start:'2026-11-01',end:'2026-11-14'}]`: `total` 135, `totalTime` `'2h15'`, `byPerson` `[{by:'a',minutes:45,time:'45m'},{by:'b',minutes:90,time:'1h30'}]`, `bySprint` `[{sprint:'1',...45},{sprint:'2',...90}]` (the `-03:00` entry is 2026-11-21 UTC).
  - an entry outside every sprint and a sprint with `start: null`: `bySprint` `[{ sprint: null, minutes, time }]`.
  - no entries: `entries: []`, `total: 0`, `totalTime: '0m'`, `byPerson: []`, `bySprint: []`, `ignored` passed through.
- [ ] **Step 2:** `node --test scripts/lib/time-entries.test.mjs` fails (module missing).
- [ ] **Step 3:** Implement by moving Local's `sprintOf`/`sum` logic (uses `eventInstant` from Local and `formatMinutes` from `duration.mjs`; sort sprints by start then id, skip sprints without both dates). Local's `listTimeEntries` calls it and keeps reading its events, sprint files and `sprintsUnread`.
- [ ] **Step 4:** `node --test scripts/lib/time-entries.test.mjs scripts/lib/local/*.test.mjs scripts/contract.test.mjs` passes; then `npm test` passes.
- [ ] **Step 5:** Commit `refactor: share the time-entry summing (PMK-80)`.

### Task 2: Worklog mapping and the changelog drop

**Files:**
- Create: `scripts/lib/jira/worklogs.mjs`, `scripts/lib/jira/worklogs.test.mjs`
- Modify: `scripts/lib/jira/history.mjs` (`changesOf`), `scripts/lib/jira/history.test.mjs`

**Interfaces:**
- Produces: `toTimeEntry(worklog) -> { at, by, minutes } | null` (null when minutes round to 0 or seconds are missing); `worklogEvents(worklogs) -> [{ at, by, op: 'log_time', minutes }]` (valid ones only); `jiraStarted(date: Date) -> string` (`2026-11-22T12:00:00.000+0000`).

- [ ] **Step 1: Failing tests**: `toTimeEntry({ started: '2026-11-22T10:00:00.000+0000', author: { accountId: 'acc-1' }, timeSpentSeconds: 2700 })` deep-equals `{ at: '2026-11-22T10:00:00Z', by: 'acc-1', minutes: 45 }`; 90 s → 2 minutes; 20 s → null; missing seconds → null. `jiraStarted(new Date('2026-11-22T12:00:00Z'))` is `'2026-11-22T12:00:00.000+0000'`. In `history.test.mjs`: a history with items `{ field: 'timespent', fieldId: 'timespent', from: null, to: '2700' }` and `{ field: 'WorklogId', from: null, to: '10000' }` gives no event; a `timeestimate` item still gives `jira:timeestimate`.
- [ ] **Step 2:** Run `node --test scripts/lib/jira/worklogs.test.mjs scripts/lib/jira/history.test.mjs`: fails.
- [ ] **Step 3:** Implement; in `changesOf`, return `[]` for `timespent` and `WorklogId`.
- [ ] **Step 4:** Same command passes.
- [ ] **Step 5:** Commit `feat: map Jira worklogs to time entries (PMK-80)`.

### Task 3: Worklogs in the fake Jira

**Files:**
- Modify: `scripts/fake-jira-issues.mjs`; test in `scripts/fake-jira-issues.test.mjs` if it exists, else `scripts/lib/jira/time-ops.test.mjs` of Task 4 covers it.

**Interfaces:**
- Produces: `state.worklogs[key]` list; routes `POST ${API}/issue/{key}/worklog` (400 `badField('timeLogged', ...)` when `timeSpentSeconds` is not a positive integer; stores `{ id, author: VIEWER, started, created, updated, timeSpentSeconds }`, `id` from `state.next.worklog` starting 10000; records a changelog entry with `timespent` from/to and `WorklogId` items; answers 201 with the worklog) and `GET ${API}/issue/{key}/worklog` (offset page in `worklogs`, max 5000); `render` adds `fields.worklog = { startAt: 0, maxResults: 20, total, worklogs: first 20 }`; `removeItem` drops the item's worklogs. Options `worklogs: { [key]: [...] }` seed raw worklogs (for the >20 and rounding tests).

- [ ] **Step 1:** Failing test: POST then GET returns one worklog with `timeSpentSeconds: 2700`; the changelog gains `timespent` `'0'`→`'2700'`; a POST with `timeSpentSeconds: 0` answers 400; an item with 25 seeded worklogs renders `worklog.total` 25 and 20 `worklogs`.
- [ ] **Step 2:** Run it: fails.
- [ ] **Step 3:** Implement the routes and state (`emptyState` gains `worklogs: {}` and `next.worklog`; a restored state without them gets `??=` defaults, as `versions`).
- [ ] **Step 4:** Passes, and `node --test scripts/lib/jira/*.test.mjs` stays green.
- [ ] **Step 5:** Commit `test: worklogs in the fake Jira (PMK-80)`.

### Task 4: Time operations, history, metrics, manifest, contract

**Files:**
- Create: `scripts/lib/jira/time-ops.mjs`, `scripts/lib/jira/time-ops.test.mjs`
- Modify: `scripts/lib/jira/history-ops.mjs`, `scripts/lib/jira/history-ops.test.mjs`, `scripts/lib/jira/tracker.mjs`, `scripts/lib/jira/manifest.mjs`, `scripts/lib/jira/manifest.test.mjs`, `scripts/lib/jira/contract.test.mjs`, `scripts/lib/jira/tracker.test.mjs` (if it asserts the stubs)

**Interfaces:**
- Consumes: Task 1 `summarizeTimeEntries`, Task 2 `toTimeEntry`/`worklogEvents`/`jiraStarted`, `readBoardSprints` + `toSprint` (sprints.mjs), `ops.readItem`, `ops.requireActor`.
- Produces: `timeOperations({ client, ops, getContext, now, capability, sprints }) -> { logTime, listTimeEntries }` where `capability()` resolves the manifest's `time_tracking` entry and `sprints()` the board's raw Jira sprints; `worklogsOf(client, key)` in `worklogs.mjs` reads every page of `/worklog` (`key: 'worklogs'`, `pageSize: 5000`, `maxPages: 1000`).

- [ ] **Step 1: Failing tests** in `time-ops.test.mjs` over the fake tracker (pattern of `epic-ops.test.mjs`): `logTime(key, 45, 'acc-1')` returns `{ before, after }` equal to the issue and writes one POST with `timeSpentSeconds: 2700` and `started` `'2026-11-22T12:00:00.000+0000'`; a dry run writes nothing; `logTime(key, 0, ...)` and `1.5` → `INVALID_INPUT`; actor `'acc-2'` → `INVALID_INPUT` with no write; unknown key → `NOT_FOUND`; time tracking off (configuration route answers `timeTrackingEnabled: false` without `timeTrackingConfiguration`) → `NOT_SUPPORTED` with the hint, for both operations. `listTimeEntries` over seeded worklogs (2700 s, 20 s, 5400 s by another account, one started inside a seeded active sprint) gives `total` 135, `ignored` 1, and the per-sprint split. In `history-ops.test.mjs`: `getHistory` holds one `log_time` event with `minutes: 45` and no `jira:timespent`; `metricEvents` holds it tagged with the issue; an item with 25 worklogs yields 25 `log_time` events in `metricEvents`. In `manifest.test.mjs`: `time_tracking` is `{ path: 'native' }` (replace the `detail.site` assertions).
- [ ] **Step 2:** Run `node --test scripts/lib/jira/time-ops.test.mjs scripts/lib/jira/history-ops.test.mjs scripts/lib/jira/manifest.test.mjs`: fails.
- [ ] **Step 3:** Implement. `getHistory` reads `worklogsOf` alongside the changelog and comments and merges `worklogEvents` into the sorted events; `metricEvents` adds `worklog` to the search fields and, per item, uses `item.fields.worklog.worklogs` unless `total` exceeds their count (then `worklogsOf`). `toEvents` gains a `worklogs = []` argument. `manifest.mjs`: `SERVED.time_tracking = true`; remove `SERVED_IN` and simplify `unservedHint`. `tracker.mjs` wires `logTime`/`listTimeEntries` into `contract`. `contract.test.mjs` adds `'time'` to `families`.
- [ ] **Step 4:** `node --test scripts/lib/jira/*.test.mjs` passes, then `npm test` and `npm run lint`.
- [ ] **Step 5:** Commit `feat: Jira time tracking reads and writes worklogs (PMK-80)`.

### Task 5: Runbook and its E2E test

**Files:**
- Create: `docs/runbooks/time-jira.md`, `scripts/runbook-time-jira.test.mjs`
- Modify: `CHANGELOG.md` (one Unreleased line), any runbook index the other Jira runbooks are listed in (grep `epics-releases-jira`)

**Interfaces:**
- Consumes: the launcher pattern of `scripts/runbook-epics-releases-jira.test.mjs` (state file, `PMKIT_NOW=2026-11-22T12:00:00Z`), with a `PMKIT_FAKE_NO_TIME` switch that replaces the configuration route with `{ issueLinkingEnabled: true, timeTrackingEnabled: false }`.

- [ ] **Step 1:** Write the runbook (sections: Before you start, Capabilities, Log time, Time entries, History, Errors; "Live check: skipped", naming the EPC-14 follow-up) and the test that runs each step and asserts: `capabilities` → `time_tracking` `native`; `issues create` → `ENG-1`; `issues log-time ENG-1 1h30 --dry-run` → `minutes: 90` and `time-entries` still empty; `issues log-time ENG-1 1h30` then `45m`; `issues time-entries ENG-1` → `total: 135`, `byPerson` one row for `acc-1`, `bySprint` `[{ sprint: null, ... }]`; `issues history ENG-1` has two `log_time` events; `issues log-time ENG-1 0` → `INVALID_INPUT`; with `PMKIT_FAKE_NO_TIME` → `NOT_SUPPORTED` with the hint.
- [ ] **Step 2:** `node --test scripts/runbook-time-jira.test.mjs` fails only where the runbook and code disagree; fix the runbook text, not the assertions.
- [ ] **Step 3:** `npm test` and `npm run lint` pass.
- [ ] **Step 4:** Commit `docs: Jira time tracking runbook (PMK-80)`.
