# PMK-189: team capacity on hand-edited days off and the days-off error

## Intent
`team capacity` shows `workingDays` per member. A hand edit of `.pmkit/capacity.yaml` (or the sprint file) can list a date twice, a weekend day or a date outside the sprint. `workingDays` subtracted `daysOff.length`, so those entries lowered the count wrongly. Writes through the CLI already refuse such dates, so only a hand edit reaches this.

## Decisions
- `workingDays(sprint, daysOff)` counts the weekdays of the sprint whose date is not in the set of days off. Repeated dates, weekends and out-of-sprint dates have no effect. The `daysOff` list shown to the user is left as stored (the command reports data, it does not rewrite it).
- Criterion 2: a bad `--days-off` on `team capacity` already answers `INVALID_INPUT` (`usageError` is a `PmkitError` with that code, exit 2), which is what `commands/team/capacity.md` says. No behavior change; a test pins it for bad syntax (`ana`, `=date`, `ana=`, trailing `+`, member named twice), and the command file stays as it is. My call.

## Non-goals
Warning about hand-edited entries, and the items in `docs/superpowers/epc-6-follow-ups.md`.
