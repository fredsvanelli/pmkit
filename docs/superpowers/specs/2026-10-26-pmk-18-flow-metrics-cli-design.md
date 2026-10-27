# PMK-18: compute lead time, throughput and aging in the CLI

Decisions from an autonomous brainstorming run on 2026-10-26. No human was available. Every choice below comes from the issue, the code, the ADRs and the earlier specs, except the four questions under "Decided questions". The user answered them on 2026-10-26 and took the recommended option of each, and the design below follows those answers.

## Problem

The CLI has two metrics commands, `metrics velocity` and `metrics cycle-time`. The capability manifest reports `native_metrics` as `derived` with `detail.source: events`, and the Local adapter's capability text promises "Cycle time, lead time, throughput and aging from `events.jsonl`". Three of those four have no command.

PMK-19 adds the `flow-metrics` command from the EM catalog, which shows cycle time, lead time, throughput, aging and bug rate for a period, with the trend. ADR-0002 says a command never computes and never reads `.issues/` by hand, so PMK-19 waits for the CLI to compute the three missing metrics.

Acceptance criteria:

1. The CLI computes lead time, throughput and aging from the event log.
2. Each metric takes a date range.

## What PMK-19 needs from this issue

- A number per metric for one period, with `--json` output a command can read without arithmetic beyond comparing two runs.
- The same period flags on every metric, so the command passes one range to every call.
- A way to show the trend. PMK-19 runs each metric twice, once for the period and once for the previous period of the same length, and compares the two.
- Bug rate. `metrics throughput` returns a count per issue type, so bug rate is `byType.bug / count` for the period.
- "Computed from history". The manifest already says `derived` with `source: events`, and every new command reads only the event logs, so the command can say so from the manifest.

## Goals

- Three new read commands, `metrics lead-time`, `metrics throughput` and `metrics aging`, built on pure functions in `scripts/lib/metrics.mjs`.
- The same definitions of "started", "done" and "in range" as `metrics cycle-time`, so the four numbers agree for a given range.
- Output shapes that match `metrics cycle-time` where the metric is a distribution of days.

## Non-goals

- The `flow-metrics` command and its trend text (PMK-19).
- Bug rate as its own command, and DORA metrics.
- Changing `metrics cycle-time` or `metrics velocity` behavior. One shared range helper replaces the filter inside `metrics cycle-time`, with the same results.
- Changing `/pmkit:cycle:close`, which counts its sprint's throughput from `cycle issues`.
- A new tracker contract operation. `metrics cycle-time` reads `tracker.eventsByIssue()`, a Local adapter helper, and the new commands do the same.

## Anti-goals

- Four metrics that disagree on what "done" means. A reader who sees 3 issues in throughput and 3 lead times must not see 4 cycle times for the same range.
- Any write. The three commands are reads with no `write: true`, no dry run and no commit.

## Approaches compared

1. **One command per metric** (`metrics lead-time`, `metrics throughput`, `metrics aging`). It matches `metrics velocity` and `metrics cycle-time`, each command has one output shape, and the manifest's `SERVED_BY` lists each one.
2. **One `metrics flow` command that returns all four.** One call for PMK-19, but its output mixes four shapes, and it would duplicate `metrics cycle-time` or make it a special case.
3. **A `--metric` flag on `metrics cycle-time`.** The command name would no longer say what it returns.

Chosen: approach 1.

## Definitions

All four metrics replay one issue's `events.jsonl` from `tracker.eventsByIssue()`, in `at` order as `readEvents` returns them (it drops identical lines and sorts by `at`), as `metrics cycle-time` does today. The status an event moves the issue into comes from the existing `movedTo(event)` in `metrics.mjs`: the `to` of a `move` on `status`, or `to.status` of a `create`. Categories come from `tracker.categoryOf`, so a renamed status counts by its category in the current config.

- **Done at.** The `at` of the issue's last move into a status of category `done`, from `lastEntry(events, 'done', categoryOf)`. It is the same moment `metrics cycle-time` and `velocity` use. An issue with no move into `done` has no done time. `canceled` is not done.
- **In range.** The done time falls on or after `--since` and on or before `--until`. A date-only `--until` means the end of that day, `T23:59:59Z`, as in `metrics cycle-time` and `metricEvents`. A missing flag leaves that side open. The comparison uses `eventInstant` (a zoneless time reads as UTC), so a hand-written offset in `at` compares as an instant (PMK-121 did the same for velocity).
- **Created at.** The `at` of the issue's `create` event. A log with no `create` event uses its earliest `at`. A log written by the adapter always starts with a `create`, real or synthetic.
- **Lead time.** Done at minus created at, in calendar days rounded to one decimal, for each issue done in range. Lead time starts at creation (decided question 3).
- **Throughput.** The number of issues done in range, with a count per issue type. The type is the last value the log gives it: `to.type` of the `create`, then the `to` of each `update` on `type`. An issue with no type counts under `none`. Bug rate is `byType.bug / count` (decided question 4).
- **Aging.** For each issue in work at an instant `asOf`, the calendar days since it started, rounded to one decimal. An issue is in work at `asOf` when its status after replaying the events with `at` on or before `asOf` has category `in_progress` or `in_review`, and the log has no `archive` event on or before `asOf`. It started at its first move into `in_progress` or `in_review` on or before `asOf`. `asOf` is the end of the range, `--until`, and defaults to the CLI clock (`PMKIT_NOW` in tests). `metrics aging` takes no `--since` (decided question 2).

`in_review` counts as started for aging, so an issue that skipped `in_progress` still has an age. Cycle time keeps its own start, the first move into `in_progress`, unchanged.

## Design

### Library: `scripts/lib/metrics.mjs`

Pure functions with no file access, like the ones there today. Each takes `eventsByIssue` and `{ categoryOf }`.

- `doneInRange(eventsByIssue, { categoryOf, since, until })` returns a new `eventsByIssue` with only the issues done in range. It owns the date-only `until` rule. `metrics cycle-time` switches to it in place of its inline loop, and its results stay the same (the goldens prove it).
- `leadTimes(eventsByIssue, { categoryOf })` returns `[{ issue, days }]` for every issue with a done time, in the order of the input keys, as `cycleTimes` does.
- `throughput(eventsByIssue, { categoryOf })` returns `{ count, byType, issues: [{ issue, type, doneAt }] }` for every issue with a done time. `issues` is sorted by `doneAt`, then by id. `byType` keys are sorted by name, and `type` is `null` in `issues` for an issue with no type while `byType` counts it under `none`.
- `aging(eventsByIssue, { categoryOf, asOf })` returns `[{ issue, status, startedAt, days }]` for every issue in work at `asOf`, oldest first (largest `days`, then id).

The CLI calls `doneInRange` first and passes its result to `leadTimes` and `throughput`, as it does for `cycleTimes`. `summary(values)` gives the count, median and p85 for lead time and aging, as it does for cycle time.

### Commands in `scripts/pmkit.mjs`

| Command | Flags | Summary for `--help` |
| --- | --- | --- |
| `metrics lead-time` | `[--since d] [--until d]` | median and p85 days from creation to done |
| `metrics throughput` | `[--since d] [--until d]` | issues done in a range, by type |
| `metrics aging` | `[--until d]` | days since work started, per issue in progress or in review at a date, oldest first |

Flags go through `rangeText`, which also refuses a date that rolls over such as `2026-02-30`, so a bad date is a usage error with exit code 2, as in `metrics cycle-time`. `metrics aging` does not accept `--since`, and the CLI's unknown-option check refuses it with `INVALID_INPUT` and exit code 2, as it refuses `--bogus` today.

JSON output:

```text
// metrics lead-time --json
{ "count": 3, "median": 10.3, "p85": 11.7, "issues": [{ "issue": "ISS-4P8A", "days": 12.3 }] }

// metrics throughput --json
{ "count": 3, "byType": { "bug": 2, "feature": 1 }, "issues": [{ "issue": "ISS-9T2M", "type": "bug", "doneAt": "2026-10-05T15:00:00Z" }] }

// metrics aging --json
{ "asOf": "2026-10-23T12:00:00Z", "count": 3, "median": 8.1, "p85": 8.8, "issues": [{ "issue": "ISS-2X6D", "status": "in_progress", "startedAt": "2026-10-14T09:00:00Z", "days": 9.1 }] }
```

The lists above are cut to one entry. `median` and `p85` are `null` when `count` is 0, from `summary`. `asOf` is the instant used, as an ISO timestamp with seconds, so a reader knows which "now" the ages are relative to.

Text output:

- `metrics lead-time` prints the same three lines as `metrics cycle-time`: `count`, `median` and `p85`, with `n/a` for an empty range.
- `metrics throughput` prints `count: N`, then, when N is above 0, a `Type | Issues` table from `table()` in `format.mjs`.
- `metrics aging` prints an `Issue | Status | Started | Days` table, then `count`, `median` and `p85` lines and `as of: <asOf>`. With no work in progress it prints `no work in progress` and the `as of` line.

### Expected numbers on the `team` fixture

At the golden clock, `2026-10-23T12:00:00Z`, a check script on this branch gives:

| Command | Result |
| --- | --- |
| `metrics lead-time` | ISS-4P8A 12.3, ISS-7K3Q 10.3, ISS-9T2M 8.3. Count 3, median 10.3, p85 11.7. |
| `metrics throughput` | Count 3. `bug` 2 (ISS-7K3Q, ISS-9T2M), `feature` 1 (ISS-4P8A). ISS-0G5E and ISS-7D8K are canceled and do not count. |
| `metrics throughput --since 2026-10-06 --until 2026-10-08` | Count 2: ISS-7K3Q and ISS-4P8A. |
| `metrics aging` | ISS-2X6D 9.1 (`in_progress`), ISS-8C4W 8.1 (`in_review`), ISS-5N1R 1.1 (`in_progress`). Count 3, median 8.1, p85 8.8. |

ISS-3Q6T has no `events.jsonl` (its `issue.md` holds conflict markers), so no metric sees it.

### Capability manifest

`SERVED_BY.native_metrics` in `scripts/lib/capabilities.mjs` gains `metrics lead-time`, `metrics throughput` and `metrics aging`. The path stays `derived` with `detail.source: events`. The test that checks every name in `SERVED_BY` against `COMMANDS` covers the new names.

### Docs

- `README.md`: three rows in the CLI table, after `metrics cycle-time`.
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: three rows in the CLI table, after `metrics cycle-time`.
- No `CHANGELOG.md` entry and no `Tracker format` line. The format does not change, and the release that ships the commands writes its line, as PMK-121 did.
- No command file changes. PMK-19 writes the command that reads these.

## Decisions

| Decision | Reason |
| --- | --- |
| Three commands, one per metric. | Matches `metrics velocity` and `metrics cycle-time`, gives each command one output shape, and lets the manifest name each one. |
| Done time is the last move into `done`, from the same `lastEntry` as cycle time and velocity. | The four numbers agree for one range. A reopened issue counts the way cycle time already counts it (see follow-up 1). |
| `canceled` does not count as done. | Throughput measures delivered work, and velocity and cycle time already leave canceled issues out. |
| Archived issues count in lead time and throughput, and leave aging from the moment of their `archive` event. | `eventsByIssue` reads archived issues, and cycle time counts them. An archived issue is not open work. |
| Lead time and aging use calendar days with one decimal. | Same unit and rounding as `cycleTimes`. Business days exist in `businessDaysBetween`, but mixing units across the four metrics would mislead. |
| Aging counts `in_progress` and `in_review` as in work, and starts at the first move into either. | Both are started and unfinished. An issue that skipped `in_progress` still needs an age. |
| Aging replays only events on or before `asOf`. | An `asOf` in the past then gives the work in progress at that moment, which a trend needs. |
| The range filter moves into `doneInRange` and uses `eventInstant`. | One rule for cycle time, lead time and throughput. `eventInstant` compares offsets as instants, as PMK-121 did for velocity. For the `Z` timestamps the adapter writes, the result equals today's string comparison. |
| No check that `--since` comes before `--until`. | `metrics cycle-time` and `events` return an empty result for that case. An empty result is a correct answer. |
| `throughput.issues` carries `type` and `doneAt`, and `byType` counts `none` for an issue with no type. | A command can name the issues behind the count and read bug rate without counting itself. |
| The type comes from the event log, not from `issue.md`. | The criterion says "from the event log", and the replay gives the type even for an issue whose file no longer parses. |
| `metrics aging` echoes `asOf`. | The default comes from the clock, so the output has to say which instant it used. |
| No contract change. | `metrics cycle-time` already reads `eventsByIssue`, a Local adapter helper. A hosted adapter that serves these metrics adds its own source then. |

## Acceptance criteria map

| Criterion | Design part |
| --- | --- |
| The CLI computes lead time, throughput and aging from the event log | `leadTimes`, `throughput` and `aging` in `metrics.mjs`, fed by `eventsByIssue`; the three commands; the manifest's `SERVED_BY`. |
| Each metric takes a date range | `--since` and `--until` on `metrics lead-time` and `metrics throughput` through `doneInRange`; `--until` as the as-of date on `metrics aging`, which reads the criterion as "takes the end of the range" (decided question 2). |

## Tests to write in the plan

- `scripts/metrics.test.mjs`
  - `doneInRange`: date-only `until` includes the whole day, open sides, an offset timestamp compared as an instant, an issue with no done move left out.
  - `leadTimes`: from the `create`, from the earliest event when there is no `create`, a move back out of `done` then into it again uses the last done.
  - `throughput`: canceled left out, type from `create`, type changed by an `update`, no type counted under `none`, sorted by `doneAt` then id.
  - `aging`: `in_progress` and `in_review` counted, `todo` and `done` not, start at the first move into either category, an issue moved back to `todo` before `asOf` left out, events after `asOf` ignored, an archived issue left out from its `archive` event, oldest first.
  - On the `team` fixture: the numbers in "Expected numbers on the `team` fixture".
- `scripts/cli.test.mjs`
  - Each command with and without a range on `team`, a bad date exits 2, `metrics aging --since` exits 2, `PMKIT_NOW` sets `asOf`.
  - `metrics cycle-time` keeps its counts for `--until 2026-10-08` and `--until 2026-10-07` after the switch to `doneInRange`.
  - Add the three names to the `--help` list and to the `READS` map.
- `scripts/fixtures.test.mjs`: `no-sprints` runs the three commands with exit 0.
- `scripts/goldens.test.mjs`: add the three commands with `() => [[]]`, and generate `metrics-lead-time.txt`, `metrics-throughput.txt` and `metrics-aging.txt` for every golden fixture. Every existing golden stays unchanged, `metrics-cycle-time.txt` and `capabilities.txt` included. `capabilities.txt` prints the path and the detail of `native_metrics`, not `SERVED_BY`.

## Decided questions

The user answered these on 2026-10-26 and chose the recommended option of each. The options left out stay below as the record of what was weighed.

1. **How PMK-19 gets the trend.** The criterion of PMK-19 says "with the trend".
   - A. Each command reads one range. PMK-19 runs each metric for the period and for the previous period of the same length and compares them. No CLI change for the trend.
   - B. Each command takes `--compare` and adds a `previous` block computed for the range of the same length just before.
   - C. `metrics throughput` takes `--by week` and returns a weekly series, and the trend is the series.

   Decided: A. It keeps one output shape per command and needs no new flag. A comparison of two numbers is not a computation ADR-0002 keeps out of commands, since `/pmkit:cycle:close` already compares planned and delivered counts. B or C can come later if PMK-19 needs more than two points.

2. **What a date range means for aging.** Aging is a snapshot of the open work at one instant, and the criterion says each metric takes a range.
   - A. `metrics aging [--until d]`. `--until` is the as-of date and defaults to now. `--since` is refused as an unknown flag.
   - B. `metrics aging [--since d] [--until d]`. The snapshot is at `--until`, and `--since` is accepted and ignored, so PMK-19 passes one range to every call.
   - C. `metrics aging [--since d] [--until d]` lists every issue in work at any moment of the range, aged up to `--until` or up to when it left work.

   Decided: A. It gives PMK-19 aging at the end of each period, which is what a trend of aging needs, and it does not accept a flag that does nothing. C mixes finished work into aging and overlaps cycle time. A reads the criterion as "takes the end of the range", and the user confirmed that reading.

3. **Where lead time starts.**
   - A. At creation, the `create` event.
   - B. At the first move into `todo` or later, when the team committed to the work.

   Decided: A. It is the usual definition of lead time (request to delivery), it differs from cycle time, and every issue has a `create`. Under B, an issue created straight into `todo` gives the same number as A, and one that skipped `todo` needs a rule for its start.

4. **Whether throughput breaks down by type so PMK-19 can show bug rate.**
   - A. Yes. `metrics throughput` returns `byType` and a `type` per issue, and bug rate is `byType.bug / count`.
   - B. No. PMK-19 asks for its own CLI change for bug rate, and bug rate can then mean something else, such as bugs created per period.

   Decided: A. It costs one map in the output and lets PMK-19 meet its criterion with no further CLI change. Bug rate counts bugs done in the period, not bugs created.

## Follow-up candidates

1. A reopened issue (moved out of `done` and not back) keeps its last done time, so cycle time, lead time and throughput count it, and aging may count it too while it is back in work. A rule such as "count only when the last status move is into `done`" would fix all three. Changing cycle time is out of scope here.
2. An issue whose `issue.md` was hand-edited into `in_progress` has no `move` event until the next write records the drift, so aging misses it until then. `/pmkit:local:doctor` could list such issues.
3. `/pmkit:cycle:close` step 5 could read `metrics throughput --since <start> --until <end>` in place of counting done issues, once the user decides whether sprint throughput means "done in the sprint" or "done in its dates".

## Left to the builder

- The names of private helpers, and whether `aging` reuses `movedTo` through a small replay helper shared with `leadTimes`.
- The exact column widths and the order of the text lines, within the shapes above.

## Self-review

- Each acceptance criterion maps to a design part. The second one holds for aging through decided question 2.
- The definitions, the commands, the JSON samples and the decisions agree. The sample numbers come from a check script run on this branch against the `team` fixture at the golden clock.
- The scope is three read commands, four pure functions, one manifest line, two doc tables and tests. No write, no format change and no migration.
- Risk: `metrics cycle-time` moves to `doneInRange`, and `/pmkit:cycle:close` reads that command. The existing cycle-time tests and goldens catch any change in its results.
