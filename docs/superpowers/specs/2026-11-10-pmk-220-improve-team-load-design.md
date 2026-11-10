# PMK-220: improve team load (design)

Source: PMK-71 follow-ups (`docs/superpowers/epc-6-follow-ups.md`). The brainstorming ran without the user (orchestrated run): the choices below are the worker's, each with its reason.

## Goals

1. A config key for the 1.5 overload threshold.
2. A column with the issues each person delivered in the sprint.
3. Blocked issues counted when the command proposes moves.
4. Capacity, days off and the flow history read once.

## Non-goals

- No change to `unit` selection, `noWork`, `no_availability` or the over-capacity rule.
- No change to the load itself: a blocked issue still counts in the load of its holder.
- No new command, so no change to the command-file count lists in the tests.

## 1. `defaults.overload_factor`

- `.issues/config.yaml` `defaults.overload_factor`: a number of 1 or more, default `1.5` (1 flags anyone above the average). `validate` refuses anything else (a string, below 1, a non-finite number). The existing `defaults` rule (positive integer) gets this one exception.
- `teamLoad(..., { overloadFactor })` and `proposeMoves` use it where they used the `OVER_AVERAGE` constant. The report carries `overloadFactor`, so `proposeMoves` and the text read the same number. `OVER_AVERAGE` stays as the default.
- Linear has no local config: `settings()` returns the built-in defaults, so Linear keeps 1.5. The note on the command says nothing extra; the report shows `overloadFactor` in the header line only when it is not 1.5.
- Schema (`schemas/issues.config.schema.json`) and `templates/issues.config.yaml` list the key.

## 2. Delivered column

- `delivered`: the issues in category `done` in the sprint in scope, per assignee, one search `searchIssues({ categories: ['done'], sprint })`. Counted in issues whatever the unit, because it answers "who finished work", not "how much load".
- No sprint in scope (no active sprint, or `--sprint current` with none): `delivered` is `null` on every row and the column is left out of the text. Nothing is read.
- An incomplete read (`hasMore`, or an issue file that does not parse) makes `delivered` `null` for every row, with a warning: "the delivered count is not verified". It is never shown as 0.
- A done issue held by someone with no row (a person who left) gets a row marked `(not a member)`, like open work does. Unassigned done issues are counted in `unassigned.delivered`.
- `delivered` is not part of the load, the average or the flags.

## 3. Blocked issues

- A blocker is open when its category is not `done` or `canceled`. The blockers inside the scope are known; the others are read once each with `getIssue`. A blocker that cannot be read counts as blocking (the model's rule for an unknown blocker) and a warning says its state is not verified.
- Each row gets `blocked`: its open issues with an open blocker (a count, shown in a `Blocked` column).
- `proposeMoves` never proposes a blocked issue in `todo`: moving it does not free the giver, because nobody can start it. When the only issues that could move are blocked, the reason is the new `blocked` ("the issues in todo that could move are blocked, so moving them would not free anyone"). A member with `no_availability` still gives away blocked work, because that member cannot take any.
- Reading the blockers is a read, so an incomplete read (a `getIssue` that fails) leaves the issue counted as blocked and the warning says so; the command does not conclude "nothing blocks it" from it.

## 4. Read once

- `teamLoadReport` calls `discover()` and `capabilities()` once each and passes the result to the aging and the notes (they called each up to 3 and 5 times).
- `team capacity` read the tracker twice with a write: once for the current load and once for the load after the change, and read `getCapacity` a third time to merge. It now reads the inputs once and computes both reports from them (`readLoadInputs` then `buildLoadReport`), and reuses the capacity it read.
- `team load` itself reads each of `searchIssues`, `getCapacity`, `getDaysOff`, `metricEvents` once. A test counts the tracker calls.

## Command file (`commands/team/load.md`)

Step 2 lists the `Delivered` and `Blocked` columns and the not-verified rules; step 3 lists the `blocked` reason. The scenario (`scripts/__scenarios__/team-load.*`) and the goldens follow the new columns. README and `skills/pmkit/SKILL.md` keep their command table (no new command); `CHANGELOG.md` gets one line.
