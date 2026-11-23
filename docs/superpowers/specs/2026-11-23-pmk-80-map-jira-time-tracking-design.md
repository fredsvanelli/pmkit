# PMK-80: Map Jira time tracking

Issue PMK-80, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Acceptance criterion: "`log_time` and `list_time_entries` read and write Jira worklogs". Written on 2026-11-23 by a dispatched worker with no live user dialogue, from the issue, ADR 0013 to 0017, the PMK-76 to PMK-79 specs, the Local time tracking code and the code. Calls marked **(builder's call)** change no acceptance criterion; the owner can override any of them. Status: draft for the Interview. No Jira credentials exist, so nothing here was checked against a live site.

## Intent

After PMK-79 a Jira repository reads and writes work items, sprints, epics and versions, but `logTime` and `listTimeEntries` are `NOT_SUPPORTED` stubs and the manifest reports `time_tracking` absent, naming PMK-80. So `pmkit issues log-time` and `pmkit issues time-entries` (and `/pmkit:issues:progress`, which logs time) cannot run on Jira. The Unified model maps time tracking to Jira's native worklogs.

## Goals

- `logTime(id, minutes, actor, { dryRun })` adds a worklog to the work item.
- `listTimeEntries(id)` reads the work item's worklogs, in the Local result shape: `{ issue, entries, total, totalTime, byPerson, bySprint, ignored }`.
- Worklogs show in `getHistory` and `metricEvents` as `log_time` events, so the contract suite's `time` family runs on Jira.
- The manifest serves `time_tracking`: `native` when the site's time tracking is on, else absent with "Turn on time tracking in Jira's global settings" (unchanged).

## Non-goals

- Editing or deleting a worklog, a worklog comment, a "remaining estimate" adjustment (`adjustEstimate`): pmkit's `log-time` has none of these. Jira's default (`adjustEstimate=auto`) applies.
- Logging time for another person: Jira records every write as the token's owner (ADR 0013), so `--as` someone else refuses, as for every Jira write.
- A delete preview warning about logged time (Local's "N minutes logged on it are deleted with it"): filed under EPC-14 as a follow-up.
- Live checks: recorded as skipped and filed under EPC-14.

## Anti-goals

- A dry run that sends a write.
- Logged time counted twice in the history (once from the worklog, once from the changelog's `timespent` change).

## Facts from Atlassian's Jira Cloud REST documents (unverified on a live site)

| Call | Use |
|---|---|
| `POST /rest/api/3/issue/{key}/worklog` | Body `{ timeSpentSeconds, started }`; `started` is `yyyy-MM-dd'T'HH:mm:ss.SSSZ` (for example `2026-11-22T12:00:00.000+0000`). Answers 201 with the worklog. Refused (400 or 403) when time tracking is off or the user lacks "Work on issues". |
| `GET /rest/api/3/issue/{key}/worklog?startAt&maxResults` | Offset page in `worklogs`: `id`, `author { accountId }`, `started`, `created`, `timeSpentSeconds`. |
| `worklog` field on a work item (search or GET) | `{ startAt, maxResults, total, worklogs }`, the first 20 worklogs only. |
| Changelog on a worklog | Items with field `timespent` (seconds, from/to), `timeestimate` and `WorklogId`. |

## Approaches

1. **Worklogs as the source of entries and events (chosen).** `listTimeEntries` and `getHistory` read `/issue/{key}/worklog`; `metricEvents` asks for the `worklog` field in its search and reads `/worklog` only for an item with more than 20. Each worklog is one `log_time` event `{ at, by, op: 'log_time', minutes }`. The changelog's `timespent` and `WorklogId` items are dropped from the events, so time is never counted twice. Documented calls, one event per entry, the same minutes in history and in the entries list.
2. **The changelog's `timespent` changes as `log_time` events.** No extra read, but an edited or deleted worklog shows as a negative or odd entry, the changelog shape for worklogs is less documented, and `listTimeEntries` would still need the worklogs. Rejected.
3. **A work-item property holding pmkit's entries.** Invisible to Jira's own time tracking and reports; the AC names worklogs. Rejected.

## The entry model

A worklog as a pmkit entry, by a pure `toTimeEntry(worklog)` in a new `scripts/lib/jira/worklogs.mjs`:

| pmkit | Jira worklog |
|---|---|
| `at` | `started`, as ISO UTC with `jiraTime` (Q1) |
| `by` | `author.accountId` |
| `minutes` | `timeSpentSeconds / 60`, rounded to the nearest minute (Q2) |

A worklog whose minutes round to 0, or with no `timeSpentSeconds`, is left out and counted in `ignored`, as Local counts a hand-edited bad `log_time` event.

`bySprint`: an entry counts for the board sprint whose `start..end` holds the UTC date of its `at` (the first by start when several do), else `sprint: null`: Local's rule, over the sprints `readBoardSprints` returns (PMK-78). A space with no Scrum board, or a sprint with no dates (future), counts nothing; every entry is `sprint: null`.

The summing (entries, `total`, `totalTime`, `byPerson`, `bySprint`, `ignored`) moves out of the Local tracker into a shared pure function, so both trackers give the same shape from the same code **(builder's call)**. Local keeps its own reads (events and sprint files) and its `sprintsUnread`.

## Operations

- `logTime(id, minutes, actor, { dryRun })`:
  1. The manifest's `time_tracking` entry first: absent → `NOT_SUPPORTED` with its hint, as `delegate` does. The CLI already reads the capability before it parses the time.
  2. `isPositiveMinutes(minutes)`, else `INVALID_INPUT`, `minutes must be a positive integer` (Local's rule).
  3. `requireActor(actor)` (the viewer check), then `readItem(id)` (`NOT_FOUND` for an unknown key).
  4. Dry run: `{ before: issue, after: issue }` and no request. Else `POST .../worklog { timeSpentSeconds: minutes * 60, started: <now, Jira format> }`, then `{ before: issue, after: issue }` (Local's shape; a worklog changes no pmkit issue field).
- `listTimeEntries(id)`: the capability check, `readItem(id)`, every page of `/worklog` (`maxPages: 1000`, as the changelog), the board's sprints, the shared summing.
- `getHistory(id)`: the worklogs join the changelog and the comments as `log_time` events, sorted by `at`.
- `metricEvents(...)`: the search asks for `worklog` too; an item whose `worklog.total` is above the worklogs it carries reads `/worklog`. Its `log_time` events are cut by `since` and `until` like the rest.
- `history.mjs` drops changelog items whose field is `timespent` or `WorklogId` **(builder's call)**; `timeestimate` (remaining estimate) stays as `jira:timeestimate`, as today.

When time tracking is off, `getHistory` and `metricEvents` still return what Jira holds (no worklogs means no `log_time` events); only `logTime` and `listTimeEntries` refuse **(builder's call)**.

## Manifest

`SERVED` gains `time_tracking`; `SERVED_IN` becomes empty, so it and its use in `unservedHint` go.

## Tests and runbook

- Unit tests: `worklogs.test.mjs` (mapping, rounding, ignored), the shared summing (moved Local tests stay green), `history.test.mjs` (dropped items), `history-ops.test.mjs` (worklogs in history and metric events), the time operations, `manifest.test.mjs`.
- The stateful fake `scripts/fake-jira-issues.mjs` gains worklogs: `POST` and `GET .../worklog`, the `worklog` field on reads (first 20), and the changelog's `timespent` and `WorklogId` items on a write, as Jira records them.
- `scripts/lib/jira/contract.test.mjs` adds the `time` family.
- Runbook `docs/runbooks/time-jira.md`, verified by `scripts/runbook-time-jira.test.mjs` over the fake: `capabilities` (`time_tracking` native), `issues log-time` dry run and real run, `issues time-entries` (entries, totals, per sprint), `issues history` showing the `log_time` event, a bad time (`INVALID_INPUT`), and a site with time tracking off (`NOT_SUPPORTED`). Live steps are listed as skipped.

## Risks

- Every REST shape above comes from the documents, not a site (EPC-14): the `started` format, the `worklog` field's cap of 20, the changelog items a worklog writes.
- `started` is written as now; Jira may show it in the user's zone, which is display only.

## Open questions for the Interview

- Q1 Entry time: `at` is the worklog's `started` (when the work is dated, which a Jira user can backdate) rather than `created` (when it was logged). Recommended: `started`, because sprint attribution and Jira's own reports use it; for time pmkit logs the two are the same.
- Q2 Seconds that are not whole minutes (Jira's API accepts any seconds): round to the nearest minute, and ignore an entry that rounds to 0. Recommended over ignoring every non-whole entry, which would drop time Jira counts.

## Left to the builder

Module boundaries, fake internals, test names, the name of the shared summing function.
