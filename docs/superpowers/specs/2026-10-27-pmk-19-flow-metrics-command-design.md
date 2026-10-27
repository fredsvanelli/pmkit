# PMK-19: add the flow-metrics command

Decisions from an autonomous brainstorming run on 2026-10-27. Every choice below comes from the issue, the code, the ADRs, the conventions and the PMK-18 spec. The user answered the three questions of the first draft by accepting every recommendation, and "Decisions on the open questions" records the answers.

## Problem

The EM catalog lists `flow-metrics`: cycle time, lead time, throughput, aging and DORA when possible, with the degradation "Computed from history". The Linear tab adds "with trend". PMK-18 gave the CLI the five numbers this needs: `metrics cycle-time`, `metrics lead-time`, `metrics throughput` (with a count per type), `metrics aging` and the shared `--since` and `--until` flags. No command shows them together yet.

Acceptance criteria:

1. Shows cycle time, lead time, throughput, aging and bug rate for a period, with the trend.
2. Says the numbers were computed from history.
3. Writes nothing.

## Goals

- One read-only command, `/pmkit:team:flow-metrics`, that shows the five numbers for a period next to the same numbers for the previous period.
- The trend comes from running each CLI metric twice, once per period, as the user decided during PMK-18. The CLI gets no `--compare` flag.
- The output says the numbers come from the event history and names the counts behind each number.
- No CLI change. Every number comes from a PMK-18 command.

## Non-goals

- DORA metrics. The Local tracker records no deployments, so the command says in one line that they are not included. A tracker that holds deployment data adds them later.
- Filters by epic, member, type or label. The metrics commands take a date range only.
- A trend over more than two periods, charts, and forecasts.
- Any write. The command has no confirmation point, no `--dry-run` call and no commit.
- Changes to the PMK-18 commands, `/pmkit:cycle:close` or `/pmkit:cycle:plan`.

## Anti-goals

- A command that computes metrics itself. ADR-0002 keeps computation in the CLI, so the command reads numbers and compares two of them.
- A trend that hides thin data. A change from 1 issue to 2 issues must show its counts, so the reader can see it says little.
- A trend between periods of different length or different measuring basis.

## Where the command lives

`commands/team/flow-metrics.md`, shown as `/pmkit:team:flow-metrics`. The file does not exist yet, so this spec names it without the plugin-root prefix. The `team` group holds the EM digests (`standup`), and the command reads the whole tracker for a team, not one epic, so `report` (epic status updates that get published) fits less well. The plan adds the file to these places:

- `COMMANDS.team` in `scripts/plugin.test.mjs`.
- The command list in `README.md` and the routing table in `skills/pmkit/SKILL.md`. The test "every command is listed in the skill table and in the README" requires both.
- A scenario module, `scripts/__scenarios__/team-flow-metrics.mjs`, and its snapshot. The scenario test requires one per command file.

`commands/help.md` reads the command list from the files, so it needs no change. No `CHANGELOG.md` entry and no `Tracker format` line, as in PMK-18. The release that ships the command writes its line.

## Design

### Parameters

`$ARGUMENTS` takes `[since <date>] [until <date>]`, both as `YYYY-MM-DD`. `argument-hint: "[since <date>] [until <date>]"`, the same style as `/pmkit:team:standup`.

- `until` defaults to today.
- `since` defaults to the start of a window of `defaults.sprint_length_days` days that ends on `until` (14 when missing in `.issues/config.yaml`). Decision 1 fixes this default.

A command needs both bounds, because the previous period has to have the same length. A `since` after `until` is a mistake in the input, so the command asks for corrected dates and does not call the CLI.

### The two periods

Both bounds are dates, and the CLI reads a date-only `--until` as the end of that day. A period from `since` to `until` is therefore `N` whole calendar days, with `N` = days from `since` to `until` plus 1. The previous period is the `N` days that end the day before `since`.

| Period | `since` | `until` |
| --- | --- | --- |
| Period | `S` | `U` |
| Previous | `S` minus `N` days | `S` minus 1 day |

For `S = 2026-10-06` and `U = 2026-10-08`, `N` is 3 and the previous period runs from `2026-10-03` to `2026-10-05`. The two periods do not overlap and leave no gap. The command computes the two dates itself, as `/pmkit:team:standup` computes its start date. Decision 2 rules out a CLI helper.

### Steps

Each CLI call ends with `--json`, as the scenario test requires.

1. Read the conventions. Run `capabilities --json` and read `native_metrics`. When its path is `derived` and `detail.source` is `events`, go on and use the line in Output. When the path is `absent`, stop and say the tracker has no metrics, with the manifest's `enableHint`.
2. Resolve the period and the previous period from the parameters, as above.
3. For the period, run `metrics cycle-time --since S --until U`, `metrics lead-time --since S --until U`, `metrics throughput --since S --until U` and `metrics aging --until U`.
4. For the previous period, run the same four calls with the previous dates. `metrics aging` takes only `--until`, so the previous call gives the work in progress at the end of the previous period. This is the "aging at the end of each period" that PMK-18 chose for the trend.
5. Compute bug rate for each period as `byType.bug` (0 when the key is missing) divided by `count` of `metrics throughput`, shown as a percentage with the two counts, for example `50% (1 of 2)`. When `count` is 0, bug rate is `n/a`. PMK-18 defines bug rate as bugs done in the period over issues done in the period.
6. Compare each metric with its previous value as the trend.

The command runs the eight calls in the order above, and none writes. The procedure has no confirmation point.

### The trend

For cycle time, lead time and aging, the number is the median in days, with `p85` next to it and the `count` it comes from. For throughput, the number is `count`. For bug rate, it is the percentage.

The change column is the plain difference of the two values, in the unit of the metric, with a sign: `+1.5 days`, `-2 issues`, `+10 points` for bug rate (percentage points). The word beside it is `up`, `down` or `same`, by comparing the two values as the CLI printed them. The command gives no verdict such as "better" or "worse" (decision 3).

The change is `n/a` when either period has a count of 0, since a median does not exist then. The command does not turn this into a percentage change, so it does no division beyond bug rate.

When either period has fewer than 5 issues behind a metric, the output adds one line saying the sample is small, with the counts.

### Output

A table first, then the source line and the short notes.

```text
Flow metrics, 2026-10-06 to 2026-10-08, against 2026-10-03 to 2026-10-05

Metric       | Period            | Previous         | Change
-------------|-------------------|------------------|------------------
Cycle time   | 7.8 days (n 2)    | 4.3 days (n 1)   | +3.5 days, up
Lead time    | 11.3 days (n 2)   | 8.3 days (n 1)   | +3.0 days, up
Throughput   | 2 issues          | 1 issue          | +1 issue, up
Aging        | none              | 6.1 days (n 2)   | n/a
Bug rate     | 50% (1 of 2)      | 100% (1 of 1)    | -50 points, down
```

The cycle time, lead time and throughput rows are illustrative. The scenario run on the `team` fixture fixes the real ones.

After the table:

- The source line. "Computed from the event history of each issue (`events.jsonl`), not read from a tracker report." It takes this wording from the manifest path `derived` with source `events`, as conventions rule 4 asks.
- Cycle time and lead time count the issues done in the period. Aging counts the issues in work at the end of the period. Say so in one line, because the two groups answer different questions.
- "DORA metrics are not included: the tracker holds no deployment data."
- The small-sample line, when it applies.

Lead with the table. Write the dates in full, and no issue IDs appear, since the CLI's per-issue lists are not part of the answer.

### Scenario on the `team` fixture

`scripts/__scenarios__/team-flow-metrics.mjs` uses the `team` fixture, no GitHub host and the prompt `/pmkit:team:flow-metrics since 2026-10-06 until 2026-10-08`. The fixture clock is `2026-10-23T12:00:00Z`.

- Period `2026-10-06` to `2026-10-08`: throughput 2 (one bug, one feature), cycle time median 7.8 days, lead time median 11.3 days.
- Previous period `2026-10-03` to `2026-10-05`: throughput 1 (one bug), cycle time 4.3 days, lead time 8.3 days.
- Bug rate: 50% (1 of 2) against 100% (1 of 1).

Aging is `none` at 2026-10-08 (no issue in work, so the change is `n/a`) and 6.1 days over 2 issues at 2026-10-05. These figures come from a run of the PMK-18 commands on a copy of the fixture outside the repo. The `expect` function asserts that no event is appended, that the eight calls ran, and the throughput counts above. The `LIVE_EXPECT_STOPS` map in `scripts/scenarios-live.mjs` gets an entry for the scenario, as `team-standup` has, because the live suite cannot check the numbers the agent shows.

The scenario rules match calls by flag names. Each distinct call of the procedure must appear in the command file, and the file must write the period call and the previous call as separate lines so rule 6 sees both.

### Edge cases for "If something is missing"

- No events in the period: say so, show the previous period's numbers, and give the trend as `n/a`.
- No work in progress at one end date: aging shows `none`, and the change is `n/a`.
- A new tracker with no history before the previous period: the previous column is `n/a` and the command says there is no earlier data.
- `since` after `until`, or a date that does not exist: ask for corrected dates. A CLI `INVALID_INPUT` follows the conventions' rules for reading errors.
- `native_metrics` absent: stop, as in step 1.
- A CLI error: apply the rules for reading errors in the conventions.

## Decisions

| Decision | Reason |
| --- | --- |
| Group `team`, name `flow-metrics`. | The catalog name is `flow-metrics`. `team` holds the EM digests, and `report` is for published epic updates. |
| The trend runs each metric twice and compares. | The user decided it during PMK-18. It keeps one output shape per CLI command. |
| The previous period has the same number of calendar days and ends the day before `since`. | A fair comparison needs equal length, and no overlap or gap keeps each issue in one period. |
| Aging is read at `--until` of each period. | PMK-18 gave aging only `--until`, and a snapshot at each end shows the trend of open work. |
| Bug rate is `byType.bug / count`, shown with both counts. | PMK-18 defined it and the counts keep a thin sample visible. |
| The change is a plain difference with `up`, `down` or `same`. | It needs only a subtraction of two CLI numbers, like the planned-against-delivered counts in `/pmkit:cycle:close`, and not a percentage change. |
| Counts appear next to every median. | A median of one issue and a median of twenty issues look the same without them. |
| Small samples get one line, below 5 issues. | It warns without hiding the numbers. |
| The command says DORA is not included. | The catalog says "when possible". The Local tracker has no deployment events. |
| No CLI change and no new tracker operation. | PMK-18 built what this needs. |
| `native_metrics` `absent` stops the command, `derived` with `source: events` goes on. | The manifest is how every command learns what the tracker can do (conventions rule 1). |

## Acceptance criteria map

| Criterion | Design part |
| --- | --- |
| Shows the five numbers for a period, with the trend | Steps 3 to 6, "The trend" and the table in Output. |
| Says the numbers were computed from history | The source line in Output, taken from the manifest in step 1. |
| Writes nothing | Eight reads, no confirmation point, and the scenario asserts that no event is appended. |

## Tests to write in the plan

- `scripts/plugin.test.mjs`: add `flow-metrics` to `COMMANDS.team`. The existing tests then check the six sections, the conventions line, the CLI names and the README and skill-table entries.
- `scripts/__scenarios__/team-flow-metrics.mjs` and its `.after.txt` snapshot, generated with `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`. The scenario test then checks that every flag exists and every call ends with `--json`.
- A test that fails on a missing procedure line, for example that `commands/team/flow-metrics.md` calls all four metrics for both periods. It parses the file, like the PMK-122 test of `plan.md`, because the scenario matcher compares flag names only.
- `npm test` stays green.

## Decisions on the open questions

The user accepted the recommendation for each question.

1. **What the default period is.** Without arguments the command needs a period.
   - A. The last `defaults.sprint_length_days` days (14 by default), ending today. Needs no sprint.
   - B. The last 30 days, a fixed window.
   - C. The last closed sprint against the one before it. Matches the sprint rhythm, but fails in a project with fewer than two closed sprints.
   - D. No default. The command asks for the dates with `AskUserQuestion`.

   Chosen: A. It works in every project, it follows a number the team already configured, and a period of one sprint length compares like with like.

2. **Who computes the previous period's dates.**
   - A. The command does the calendar arithmetic, as `/pmkit:team:standup` does for its start date. No CLI change.
   - B. A small CLI command or flag returns the previous period for a range, so the command only reads the dates. A CLI change in an issue that has none today.

   Chosen: A. The user decided that PMK-19 adds no CLI flag, and one date subtraction has a precedent. The scenario fixes a known pair of dates, so a wrong subtraction fails a test.

3. **Whether the trend says better or worse.**
   - A. No verdict. The command shows `up`, `down` or `same` and the difference.
   - B. A fixed verdict per metric: lower is better for cycle time, lead time, aging and bug rate, higher is better for throughput.
   - C. As B, but only when the change is at least 10% and both periods have 5 or more issues.

   Chosen: A. A rise in throughput can mean smaller issues, and a drop in cycle time can mean a few quick fixes, so the numbers alone do not say better or worse. The reader decides.

## Follow-up candidates

1. Filters by epic, member or type on the metrics commands, then in the command.
2. `/pmkit:cycle:close` could show the same trend for the closed sprint against the one before it.
3. DORA metrics once a tracker or git host provides deployment data.

## Left to the builder

- The wording of the notes and the exact column widths, inside the shapes above.
- How the file lays out the period and previous-period calls as separate lines.

## Self-review

- Each criterion maps to a design part. The command has no write, no `--dry-run` call and no confirmation point.
- The sample numbers for the `team` fixture come from the PMK-18 commands run on a copy of the fixture at the golden clock.
- The scope is one command file, three doc and test edits, one scenario and its snapshot. No CLI change and no format change.
- Risk: the date subtraction by the agent (decision 2). The scenario and the live suite catch a wrong pair of dates.
