# PMK-4: record days off per sprint from the CLI

Decisions from an autonomous brainstorming run on 2026-10-25. No human was available, so every choice below was made from the issue, the code and the ADRs, and is treated as approved. The base documents are `docs/superpowers/specs/2026-10-23-pmkit-design.md` (`SprintFile.days_off`, plan-cycle) and `docs/superpowers/specs/2026-10-23-pmkit-mvp-skills.md`.

## Problem

A sprint file has a `days_off` map from member to dates. `cycle capacity` reads and sets only `capacity`, so `/pmkit:cycle:plan` (step 4) says "The CLI cannot record days off, so they feed only this calculation". The days off the user gives are lost after the plan is made.

## Approaches compared

1. **Extend `cycle capacity` with a `--days-off` flag.** Same command, same `before`/`after` and dry run path. Capacity and days off are two inputs of the same calculation, so the command already fits.
2. **A new command `cycle days-off <id>`.** Clean separation, but `/pmkit:cycle:plan` then runs two writes (two commits with `auto_commit`) and the command table, the help and ADR 0002's command files all grow.
3. **Fold days off into `--set` (`--set ana.days_off=..`).** Mixes points with dates in one parser and breaks the numeric check on `--set`.

Recommended: approach 1.

## Design

### Command

```
cycle capacity <id> [--set member=n,..] [--days-off member=date+date,..]
```

- With neither flag the command reads. Text output lists the capacity and then the days off per member. `--json` returns `{ "capacity": {...}, "days_off": {...} }`.
- With one or both flags it writes the sprint file once, with the usual `before`/`after` result, `--dry-run` and one commit.
- `--days-off` takes `member=date` pairs. Several dates for one member are joined with `+` (`ana=2026-10-16+2026-10-19`), because `,` already separates members. The flag can repeat.
- A pair replaces that member's list. Members not named keep their list.
- `member=none` removes the member's entry from `days_off`.
- Dates are `YYYY-MM-DD`. The file keeps them sorted.

### Validation

All errors are `INVALID_INPUT` through a new `requireDaysOff(value, members, sprint)` in `scripts/lib/local/sprints.mjs`, next to `requireCapacity`. A malformed pair (no `=`, empty member) is a usage error, exit code 2, as for `--set`.

- The member must be in `.issues/config.yaml` `members`. The error lists the valid ones.
- Each date must be a real calendar date.
- Each date must fall between the sprint's `start` and `end`, inclusive, and on a weekday (Monday to Friday). A day off on a weekend does not change the working days.
- A repeated date for one member is an error.
- Half days are not supported. `days_off` stores dates, so a day is off or it is not. This is why the "integer or half day" check does not apply.
- Negative or fractional counts do not exist for the same reason.
- Closed sprints are writable, as `--set` is today.

### Tracker

Add `getDaysOff(id)` and `setCapacity` stays. Add `updateCycleCapacity(id, { capacity, daysOff }, actor, { dryRun })`, which validates what is present and calls `writeSprint` once. `setCapacity` calls it. The contract suite in `scripts/contract-suite.mjs` gets the new cases, since the Local tracker is the reference implementation (ADR 0001).

### Effective capacity

The CLI does not compute effective capacity. The formula needs the velocity, the sprint length and `availability`, and lives in `commands/cycle/plan.md` (ADR 0002: commands are the source). The stored `capacity` stays the number the user approved. `cycle capacity` shows days off beside it so the plan can be checked against both.

### `/pmkit:cycle:plan`

- Step 4 drops the sentence "The CLI cannot record days off". It still asks for dates, now validated against the sprint dates.
- Step 7 runs one call: `cycle capacity <id> --set <member>=<n>,.. --days-off <member>=<date>+<date>,.. --json`, with the values the user approved. Members without days off are left out.

## Decisions

| Decision | Reason |
| --- | --- |
| Extend `cycle capacity` with `--days-off` instead of a new command | One write, one commit, one preview. Capacity and days off feed the same calculation. |
| `member=date+date` syntax, repeatable flag | Matches `--set member=n,..`. `+` avoids the comma that separates members. Dates never contain `+`, and member ids may contain `:`. |
| A pair replaces the member's list | Idempotent and easy to reason about. Appending would need a second flag to remove. |
| `member=none` clears a member | Explicit. An empty value (`ana=`) is too easy to type by mistake. |
| Dates only, no half days | The file format stores `string[]` (spec, `SprintFile.days_off`). Changing it needs a format migration (ADR 0004), out of scope. |
| Dates must lie in the sprint and on a weekday | Gives the bound by working days without a calendar. Weekends and out-of-sprint dates never reduce capacity. |
| Read output changes to `{ capacity, days_off }` in JSON | The acceptance criterion needs a way to read days off. The flat capacity map cannot carry both. The existing CLI test is updated. |
| No effective capacity in the CLI | The formula and its inputs stay in `plan.md`. Duplicating them in code would drift. |
| Dry run and `before`/`after` as in the other sprint writes | Uses `writeSprint`, `sprintRecord` and `writeText` unchanged. |

## Acceptance criteria map

| Criterion | Design part |
| --- | --- |
| `cycle capacity <id>` reads days off per member | Read mode: text lists days off, JSON has `days_off`; `getDaysOff` in the tracker. |
| `cycle capacity <id>` sets days off per member | `--days-off` flag, `requireDaysOff` validation, `updateCycleCapacity`, `member=none` to clear, dry run. |
| `/pmkit:cycle:plan` stores the days off it asks for | `plan.md` steps 4 and 7: the sentence is removed and step 7 passes `--days-off` with `--set`. |

## Tests to write in the plan

- `scripts/sprints.test.mjs`: `requireDaysOff` and `updateCycleCapacity` (unknown member, bad date, out of range, weekend, duplicate, clear, replace, other members untouched, dry run writes nothing).
- `scripts/cli.test.mjs`: read output, `--days-off` single and repeated, `none`, bad pair exits 2, combined with `--set`, dry run. Update the capacity JSON expectation.
- `scripts/contract-suite.mjs`: days off round trip.

## Self-review

- No placeholders left. Each acceptance criterion maps to a design part.
- Syntax, validation and output agree across the Command, Validation and Decisions sections.
- Scope is one command flag, one tracker method and one command file edit. No format change, so no migration.
- Open risk: the JSON read shape change affects any caller of `cycle capacity <id> --json`. A search found only `plan.md`, which does not read it.
