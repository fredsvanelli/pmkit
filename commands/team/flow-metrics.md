---
description: Show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period
argument-hint: "[since <date>] [until <date>]"
disable-model-invocation: true
---

# Flow metrics

Arguments: `$ARGUMENTS`

## Parameters

- `since <date>` (optional): the start of the period, as `YYYY-MM-DD`. Without it, the period is a window of `defaults.sprint_length_days` days that ends on `until`. Read that number from `.issues/config.yaml` (14 when missing).
- `until <date>` (optional): the end of the period, as `YYYY-MM-DD`. Without it, the period ends today.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json` and read `native_metrics`. When its path is `absent`, stop and say the tracker has no metrics, and give its `enableHint`. Otherwise go on, and name the path from the manifest in the source line (conventions rule 4).
2. Resolve the period. Call `S` the start and `U` the end. When `since` is missing, `S` is `U` minus (`defaults.sprint_length_days` minus 1) days, so 14 days that end on 2026-10-27 start on 2026-10-14. Count real calendar days, including 28 or 29 in February. Count `N` as the days from `S` to `U` plus 1. The previous period runs from `S` minus `N` days to `S` minus 1 day, so it has the same length, ends the day before `S`, and overlaps nothing. For example, `2026-11-02` to `2026-11-04` gives `N` = 3 and a previous period from `2026-10-30` to `2026-11-01`. When `S` is after `U`, or a date does not exist, ask for corrected dates and make no CLI call.
3. For the period, run these calls. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics cycle-time --since <S> --until <U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics lead-time --since <S> --until <U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics throughput --since <S> --until <U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics aging --until <U> --json`. When `U` is today, aging is measured at the end of that day, not at the current time.
4. For the previous period, run the same four calls with its dates. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics cycle-time --since <previous S> --until <previous U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics lead-time --since <previous S> --until <previous U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics throughput --since <previous S> --until <previous U> --json`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics aging --until <previous U> --json`. The last call gives the work in progress at the end of the previous period.
5. Compute the bug rate of each period as `byType.bug` (0 when the key is missing) divided by `count`, both from `metrics throughput`. Round it to a whole percent and show it with both numbers, for example `50% (1 of 2)`. When `count` is 0, the bug rate is `n/a`.
6. Compute the trend of each metric as the period value minus the previous value, with a sign and the unit: `+1.5 days`, `-2 issues`, `+10 points` for the bug rate. Add `up`, `down` or `same`, from the values as the CLI printed them, and from the rounded values for the bug rate. The change is `n/a` for cycle time, lead time or aging when either period has a count of 0, and for the bug rate when either period has a `count` of 0 in `metrics throughput`. Throughput always shows its difference, also when one period has 0 issues. Do no division besides the bug rate. When either period has fewer than 5 issues behind a metric, add the small-sample line described in the Output section.

## Confirmation points

- None. The command only reads.

## Output

Lead with a table. Write the dates in full and show no issue IDs.

```text
Flow metrics, <S> to <U>, against <previous S> to <previous U>

Metric       | Period                    | Previous                | Change
-------------|---------------------------|-------------------------|-------------------
Cycle time   | 7.8 days (p85 8.2, n 2)   | 4.3 days (p85 4.3, n 1) | +3.5 days, up
Lead time    | 11.3 days (p85 12.1, n 2) | 8.3 days (p85 8.3, n 1) | +3.0 days, up
Throughput   | 2 issues                  | 1 issue                 | +1 issue, up
Aging        | none                      | 6.1 days (p85 7.0, n 2) | n/a
Bug rate     | 50% (1 of 2)              | 100% (1 of 1)           | -50 points, down
```

Cycle time, lead time and aging show the median in days, with the count it comes from. Add the `p85` next to the median. Aging shows `none` when no issue is in progress at the end date.

After the table, add these lines:

- "Computed from the event history of each issue (`events.jsonl`), not read from a tracker report."
- Cycle time and lead time count the issues done in the period. Aging counts the issues in work at its end.
- "This report has no DORA metrics, because the tracker holds no deployment data."
- When either period has fewer than 5 issues behind a metric, a line that says the sample is small, with the counts.

Show the change as a number and a direction only. Give no judgment on whether a change helps or hurts.

## If something is missing

- No events in the period: say so and show the numbers of the previous period. The change is `n/a` for the medians and the bug rate, and throughput still shows its difference.
- No work in progress at one end date: aging shows `none` and the change is `n/a`.
- All four calls for the previous period return a `count` of 0: say the previous period has no done issues and no work in progress at its end. The change follows step 6.
- `since` after `until`, or a date that does not exist: ask for corrected dates and make no CLI call. A CLI `INVALID_INPUT` follows the rules for reading errors in the conventions.
- `native_metrics` is `absent`: stop, as in step 1.
- An error from the CLI: apply the rules for reading errors in the conventions.
