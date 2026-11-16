# PMK-72 design: the team-capacity command

Source: Unified model, EM catalog (`team-capacity`: "Views and adjusts availability (time off, allocation)"; degradation "Stored in local context").

This design was written without a round of questions. The calls the builder made are listed in "Decisions", and each one can change in review.

## Goal

- A CLI command, `pmkit team capacity`, that shows the capacity and the days off of each human member for one sprint, and changes them in one write.
- A command file, `/pmkit:team:capacity`, that shows the table, collects the changes, previews them and writes them after a confirmation.
- The preview shows the effect of a change on the load (the flags of `team load`), computed by the same functions as `team load`.

## Non-goals

- No new storage. Local keeps capacity and days off in the sprint file, Linear in `.pmkit/capacity.yaml`, both through `updateCycleCapacity`.
- No change to the Local tracker store, to `cycle capacity` or to `scripts/lib/capabilities.mjs`.
- No change to the `availability` of a member (a 0 to 1 field of the config). It shows in the table and stays read-only.
- No capacity recalculation from velocity. `/pmkit:cycle:plan` owns that formula.

## Terms and units

- Allocation is the `capacity` of a member in a sprint, the number `cycle capacity --set` stores and `team load` reads. Its unit is the estimate unit of the tracker (`points` or `hours`), not a percentage. When the tracker has no estimate unit, the number has no label.
- Days off are weekdays inside the sprint, one entry per date, as `cycle capacity --days-off` validates them.
- `availability` is the member's share of work (0 to 1) from the config. `team load` skips a member at 0.

## The CLI command

`pmkit team capacity [--sprint current|<id>] [--set member=n|none,..] [--days-off member=date+date|none,..]`.

- Without `--set` and `--days-off` it reads and writes nothing. With either it is a write and takes `--dry-run` and `--as`.
- `--sprint` defaults to `current`, the active sprint. With no active sprint, or a tracker with cycles off, the command fails with `NOT_FOUND` and the next step `/pmkit:cycle:plan`.
- Members are the human members of the tracker. On Linear only those of `tracker.scope.team`, as `team load` does, through the same `teamMembers`. Agents (`agent:<name>`) are not listed and a write naming one is refused, with the message that `/pmkit:issues:delegate` hands work to an agent. Any other name outside the list is refused with the list of valid members.
- Read result: `{ sprint, unit, sprintWorkingDays, members, imbalances, notes, warnings }`. Each member has `member`, `name`, `availability`, `capacity` (`null` when unset, never 0), `daysOff`, `workingDays` (weekdays of the sprint minus days off), `estimate`, `load`, `flags`. `unit` is what `chooseUnit` says.
- Write result: `{ dryRun, sprint, changes, load, notes, warnings }`. `changes` has one entry per member that changes, with `member`, `capacity {before, after}` and `daysOff {before, after}`. A member whose values stay equal is left out. When nothing changes, `changes` is empty and the text says `no change`. `load` has `before` and `after`, each with the `imbalances` and the `flags` per member, so the preview shows the effect without a second calculation.
- A write is one `updateCycleCapacity` call, so a batch is atomic. Local rewrites the one sprint file and Linear the one capacity file, each through a temporary file and a rename. A bad member, date or number refuses the whole call and writes nothing. The command checks every member before the call. The tracker checks dates (format, inside the sprint, weekday, repeated) and numbers (finite, not negative).
- `--set` merges. `cycle capacity --set` replaces the whole capacity map, so the command reads the current map, applies the pairs and passes the full map. `member=none` removes the capacity of the member, which means unknown and never 0. `--days-off member=none` clears the days off of the member, as in `cycle capacity`.
- Notes: on Linear (capability `capacity` with path `derived`) a read repeats `capacity read from .pmkit/capacity.yaml; Linear has no capacity field`, and a write says `capacity and days off written to .pmkit/capacity.yaml; Linear was not changed`. A dry run says `capacity and days off would be written to .pmkit/capacity.yaml; Linear is not changed`. The notes go to stderr as `note:` lines and into the JSON.
- Load effect: the report comes from `teamLoadReport`, the function `team load` uses, called once with the stored capacity and days off and once with the ones the write would produce. When the issue read comes back cut (`hasMore`), `load` is `null`, a warning says the effect is not verified, and the write still works. An issue file that does not parse (a conflict marker) also makes the read incomplete, so `load` is null and the member flags are null. A warning names the file.

## The command file

`commands/team/capacity.md`, `/pmkit:team:capacity [sprint <id>]`.

1. Run `team capacity [--sprint <id>] --json`. Show the notes and warnings, then one table: member, availability, capacity with its unit, days off, working days, load and flags. A member with no capacity shows `not set`.
2. Ask what to change, as free text: capacity per member and days off per member. This is a choice, not a confirmation. Stop when nothing changes.
3. Run `team capacity --sprint <id> --set ... --days-off ... --dry-run --json`. Show every member that changes, field by field, and the flags before and after. More than one member is a bulk change, so the preview is full and always asked, whatever `write_policy.confirm` says. A single member gets the usual `before` and `after` and obeys `confirm`.
4. On approval run the same command without `--dry-run`. When it fails, nothing was written, because the write is one call. Show `error.message`.
5. Run `team capacity --json` again and show the table.

## Decisions

- A new `team capacity` CLI command over `cycle capacity`. The issue says to add an operation only when something is missing. Three things were: `current` as a sprint, a merge on `--set`, and a member check by team. The command file cannot do them safely in prose.
- `cycle capacity` is untouched, so existing scripts and `cycle:plan` keep working.
- Allocation is the capacity number in the estimate unit, the unit the CLI already uses, not a percentage.
- Agents are refused although the Local tracker accepts them in `cycle capacity`, because `team load` leaves them out of the average and the imbalances.
- The `availability` of the config is read-only here.
- `team load` is refactored into `teamLoadReport` so both commands share the calculation. `team load` output does not change.
