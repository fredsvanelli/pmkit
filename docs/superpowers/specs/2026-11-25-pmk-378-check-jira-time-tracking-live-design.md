# PMK-378: check the Jira time tracking flows against a live site

Issue PMK-378 (EPC-14, chore), follow-up of PMK-80. Written on 2026-11-25 by a dispatched worker; the owner's answers come through the coordinator.

## Intent

PMK-80 mapped time tracking to Jira worklogs (`time-ops.mjs`, `worklogs.mjs`, the worklog parts of `history.mjs` and `history-ops.mjs`, `time_tracking` in `manifest.mjs`) from Atlassian's documents and checked it only on the stateful fake (`scripts/fake-jira-issues.mjs`). Run the `time-jira` runbook's flows on the owner's site, settle each point the fake assumed (PMK-80 design, "Facts" and "Risks"), fix what differs, and leave a check that reruns in one line (the opt-in harness of PR #391, `scripts/lib/jira/client-live.mjs`, `PMKIT_LIVE`).

## Acceptance criteria (from the issue)

1. `POST worklog` with `timeSpentSeconds` and `started` in the `yyyy-MM-dd'T'HH:mm:ss.SSSZ` format adds the worklog, and `GET worklog` pages it in `worklogs`.
2. The `worklog` field on a search carries at most 20 worklogs with the total, so `metricEvents` reads the rest.
3. A worklog writes `timespent` and `WorklogId` changelog items (dropped from the events) and nothing else that would count the time twice.
4. With time tracking off, the configuration read reports it and `capabilities` shows `time_tracking` absent.
5. Editing or deleting a worklog in Jira writes no changelog item (such as `WorklogTimeSpent`) that `issues get --history` shows as a `jira:` update; if it does, drop it as `timespent` is dropped.
6. With time tracking off, `issues get --history` works and the worklog calls are refused as the fake assumes.

## What a live probe found (2026-11-25)

Site: the owner's (host, email and token kept out of the repository, the PR and the issue). Kudos (KAN, team-managed, Portuguese) is the site's only space and was empty. Time tracking is on: `GET /configuration` has `timeTrackingEnabled: true` and `timeTrackingConfiguration { workingHoursPerDay 8, workingDaysPerWeek 5, timeFormat pretty, defaultUnit minute }`; the provider (`GET /configuration/timetracking`) is `JIRA`. The probe made one work item through the raw client and deleted it; Kudos is as found.

| Probe | AC | Live answer | Holds? |
|---|---|---|---|
| `POST /issue/{key}/worklog { timeSpentSeconds: 5400, started: "2026-11-22T12:00:00.000+0000" }` | 1 | 201 with `id`, `author`, `started`, `timeSpentSeconds`, `created`; `started` comes back in the token owner's zone (`2026-11-22T23:00:00.000+1100`), the same instant, which `jiraTime` turns into UTC | yes |
| `POST` with `timeSpentSeconds: 100` | 1 | stored as 60 (`1m`): Jira keeps whole minutes, cut down | recorded: pmkit sends whole minutes only |
| `GET /issue/{key}/worklog?startAt=0&maxResults=1` with two worklogs | 1 | `{ startAt, maxResults, total, worklogs }`; `client.paginate` with page size 5 read all 22 of a later step | yes |
| `search/jql` and `GET /issue` with `fields=worklog`, 22 worklogs | 2 | `{ startAt: 0, maxResults: 20, total: 22, worklogs: [20] }` | yes |
| Changelog of a new worklog | 3 | `WorklogId` (to the id), `timespent` (seconds before and after) and `timeestimate` (remaining estimate, `null → 0`, then `0 → 0`) | yes for `timespent` and `WorklogId`; **`timeestimate` is a third item** (Q2) |
| Changelog of an edited worklog (`PUT .../worklog/{id}`) | 5 | `WorklogId`, `timespent`, `timeestimate`: no new kind of item | yes |
| Changelog of a deleted worklog (`DELETE .../worklog/{id}`) | 5 | `timespent`, `timeestimate`, **`WorklogTimeSpent` (from the deleted seconds, to null)**, `WorklogId` (from the id, to null) | **no** (see Fixes) |
| Time tracking off | 4, 6 | not probed: it is a site-wide setting (Q1) | open |

## Approaches

- **A. One more live test in `client-live.mjs`, running the real CLI on Kudos (recommended).** The PMK-367, PMK-370 and PMK-373 pattern: `liveRepo`, `init` with every recommendation, then the runbook's commands, each answer checked against Jira's raw answers (`client().request`). Every work item the run makes is deleted in `finally`; time tracking, when the run turns it off, is turned on again in `finally` with the provider and options it read (Q1). Opt-in, so `npm test` does not run it.
- **B. Drive `timeOperations` and `historyOperations` directly.** Fewer moving parts, but the ACs name the CLI's answers (`capabilities`, `issues get --history`) and the runbook documents the CLI. Rejected.
- **C. A new live harness.** The task says reuse PR #391's. Rejected.

A.

## Design (approach A)

### Live test, in `client-live.mjs`

`test('time tracking flows on the throwaway space', { skip: NEEDS_SPACE })` (PMK-378). It skips with a reason when the site's time tracking is off at the start (nothing to check the on-path with). Steps:

1. **Before.** Raw `GET /configuration/timetracking` (the provider) and `GET /configuration/timetracking/options`, kept to restore.
2. **Setup and capabilities.** `liveRepo`, `init` with every recommendation; `capabilities`: `time_tracking` native.
3. **Log time.** `issues create` X. `issues log-time X 1h30 --dry-run`: `minutes` 90, raw `GET worklog` has `total` 0. `issues log-time X 1h30`, then `45m`: raw worklogs 5400 and 2700 seconds, author the viewer, `started` within a minute of now (AC 1). `issues log-time X 0`: `INVALID_INPUT`.
4. **Time entries.** `issues time-entries X`: entries 90 and 45 by the viewer, `total` 135, `totalTime` `2h15`, one `byPerson` row (AC 1).
5. **Paging and the search cap.** 20 more worklogs of 60 seconds on X through the raw client (22 in all). `client.paginate` with page size 5 reads 22; raw `search/jql` with `fields=worklog` carries 20 and `total` 22 (AC 2). `issues time-entries X`: 22 entries, `total` 155. `events --since <today>` (`metricEvents`): 22 `log_time` events for X (retried: the index trails) (AC 2).
6. **History.** `issues get X --history`: 22 `log_time` events, no `jira:timespent`, `jira:WorklogId` or `jira:WorklogTimeSpent` event (AC 3).
7. **Edit and delete in Jira.** Raw `PUT .../worklog/{id} { timeSpentSeconds: 1800 }` on one 60-second worklog, raw `DELETE` of another. Raw changelog holds a `WorklogTimeSpent` item; `issues get X --history` shows 21 `log_time` events (one of 30 minutes) and no `jira:Worklog*` or `jira:timespent` event (AC 5: fails before the fix).
8. **Time tracking off** (Q1). Raw `DELETE /configuration/timetracking`. Raw `GET /configuration`: `timeTrackingEnabled` false, and whether `timeTrackingConfiguration` is still there (pmkit's discovery reads either as on: `timeTrackingConfiguration !== undefined || timeTrackingEnabled === true`). `discover`, then `capabilities`: `time_tracking` absent with "Turn on time tracking in Jira's global settings" (AC 4). `issues log-time X 1h` and `issues time-entries X`: `NOT_SUPPORTED`; `issues get X --history` works with no `log_time` event. Raw `POST` and `GET` worklog: recorded as Jira answers them (refused or not) (AC 6).
9. **On again.** Raw `PUT /configuration/timetracking { key: <provider> }` and `PUT .../options` with step 1's options; `issues log-time X 1m` works at once (the runbook's "read again on the next log-time").
10. **Cleanup** (`finally`): time tracking on again with step 1's provider and options when step 8 turned it off, checked by a raw read; the work items deleted with `removeAll`. Each key is printed (`t.diagnostic`) as soon as it exists.

Output prints keys, ids and counts only; `scrub`, `hostless` and `assertNoSecret` cover every answer.

### Fixes

Test-first, in this PR.

- **A deleted worklog's `WorklogTimeSpent` item is dropped (AC 5).** `history.mjs`'s `WORKLOG_ITEMS` gains `WorklogTimeSpent`. `history.test.mjs` first. The fake gains no worklog edit or delete: pmkit sends neither.
- **The fake writes what the site writes (AC 3).** The fake's worklog `POST` adds the `timeestimate` item the site writes, so the runbook and its test show what a user sees (Q2).
- **Discovery reads time tracking off (AC 4)**, only if step 8 shows `timeTrackingConfiguration` still present while off: then discovery reads `timeTrackingEnabled` alone. `discovery.test.mjs` first.
- Any other difference the live run finds, likewise.

### Docs

- `docs/runbooks/time-jira.md`: the live-check line records the run, what passed and what was skipped; step 5 notes the `timeestimate` events (Q2) and that a worklog edited or deleted in Jira adds no `jira:` update; notes that Jira keeps whole minutes and returns `started` in the owner's zone.
- PMK-80 design: no edit (history). No new ADR and no new `CONTEXT.md` term expected: nothing here is hard to reverse.

## Goals, non-goals, anti-goals

- Goals: each AC checked live or skipped with its reason; any difference fixed test-first; the result recorded on PMK-378 and in the runbook.
- Non-goals: company-managed space and non-admin token checks (owner's decision, open in the PR); a worklog edit or delete command in pmkit; the delete preview warning about logged time (its own EPC-14 follow-up).
- Anti-goals: a write outside Kudos other than the time tracking toggle the owner approves (Q1); anything left on Kudos, or time tracking left off or with other options; the host, email, token or account in the repository, the PR or the issue.

## Check (SPEC-SS C)

`scripts/runbook-time-jira.test.mjs` (with the `timeestimate` events), the other Jira runbook tests, then `client-live.mjs` on the live site.

## Open questions for the owner

- **Q1. Turning time tracking off.** AC 4 and 6 need the site's time tracking off, and that is a site-wide setting (`DELETE /rest/api/3/configuration/timetracking`), not a Kudos one. Kudos is the site's only space. Either the live test turns it off for steps 8 and 9 and on again in `finally` with the provider and options it read, as PMK-373 did with Releases (recommended), or AC 4 and 6 are skipped live and left open in the PR.
- **Q2. `timeestimate` on every worklog.** Jira's auto-adjust writes a remaining-estimate item with each worklog (`null → 0`, then `0 → 0` on a work item with no estimate), which `issues get --history` shows as `jira:timeestimate` updates. It counts no time twice, and PMK-80 kept it. Keep it and add it to the fake (recommended), or drop it with the worklog items.

## Left to the builder

Assertion wording, the retry interval, names of work items, and how the worklogs of step 5 are written.

## Interview

Answered on 2026-11-25 by the coordinator; the design is approved.

- Q1: the owner approved turning time tracking off with the settings read first and restored in `finally`. One try settled it: `DELETE /rest/api/3/configuration/timetracking` answers 405 and changes nothing. Atlassian removed the switch from Jira Cloud's UI and REST API in 2020 (deprecation notice "Removal of the ability to disable time tracking"). The provider (`JIRA`, the only one listed) and the options read afterwards matched those read before.
- Q3 (after Q1): yes. AC 4 and 6 are recorded as unreachable on Jira Cloud and left open in the PR. pmkit's off path (discovery, `capabilities` absent, `log-time` and `time-entries` refused) and the fake's off mode stay; runbook step 7 is checked on the fake only. Live steps 8 and 9 are dropped. No Kudos work type has the Time tracking field (Atlassian's per-space replacement), and worklogs are still accepted, so no space setting stops the worklog calls either.
- Q2: yes. `timeestimate` stays a `jira:timeestimate` update; the fake writes it with each worklog and the runbook notes it.
- No new `CONTEXT.md` term (Time entry already covers worklogs) and no ADR.

## Result

Run on 2026-11-25 against the owner's Jira Cloud site (host kept out of the repository, the PR and the issue), space Kudos: `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=<key> node --test scripts/lib/jira/client-live.mjs`. No output held the token, the email or the host. Kudos after the run: no work item; the site's time tracking provider and options as found.

| Check | AC | Result |
|---|---|---|
| `issues log-time` (dry run sends nothing; 1h30 and 45m are worklogs of 5400 and 2700 seconds by the viewer, started now), `0` is `INVALID_INPUT`, `issues time-entries` totals, `GET worklog` paged by 5 | 1 | pass |
| 22 worklogs: a search's `worklog` field carries 20 and `total` 22; `issues time-entries` and `events` (`metricEvents`) read all 22 | 2 | pass |
| `issues get --history`: 22 `log_time` events, no `jira:timespent` or `jira:WorklogId`; `jira:timeestimate` updates stay (Q2) | 3 | pass |
| Time tracking off: configuration read and `capabilities` | 4 | **unreachable on Jira Cloud** (Q1, Q3): checked on the fake only, open in the PR |
| A worklog edited (to 1800 s) and one deleted in Jira | 5 | **fail, then pass after the fix**: the delete wrote `WorklogTimeSpent`, shown as `jira:WorklogTimeSpent`; now dropped like `timespent` |
| Time tracking off: `issues get --history`, worklog calls refused | 6 | **unreachable on Jira Cloud** (Q1, Q3): checked on the fake only, open in the PR |
