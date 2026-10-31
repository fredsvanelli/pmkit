# PMK-60 log-time command design

## Intent

Give `issues log-time` a dedicated command file, `/pmkit:issues:log-time`, so a user can log time without going through `/pmkit:issues:progress`. The command accepts readable durations and shows the issue total after it writes.

## Findings

- The CLI has `issues log-time <id> <minutes>` and `issues time-entries <id>` (PMK-51). The minutes must match `^\d+$`, and the Local tracker rejects anything but a positive integer.
- No parser for readable durations exists in the CLI or in a command.
- `time_tracking` is `native` on the Local tracker and `absent` on Linear, where `issues log-time` is refused with "Linear has no time tracking" (`scripts/lib/linear/manifest.mjs`).
- `commands/issues/estimate.md` (PMK-59) is the pattern for an `absent` capability: read `capabilities`, say the path in one line, show `enableHint`, and post a comment instead.
- `commands/issues/progress.md` step 8 asks for minutes and writes the entry.

## Decisions

1. **Parser in the CLI.** `scripts/lib/duration.mjs` exports `parseMinutes(text)`. `issues log-time` calls it, so the command, `progress` and direct CLI use accept the same formats. The command file does not convert by hand.
2. **Accepted formats.** `90` (minutes), `45m`, `2h`, `1h30`, `1h30m`, `1.5h`, `0.5h`. Case is ignored and surrounding spaces are trimmed. The result must be a positive integer number of minutes.
3. **Rejected input.** Empty text, zero, negatives, text, a bare decimal such as `1.5`, a result that is not a whole number of minutes (`0.01h`), minutes of 60 or more after `h` (`1h90`), and a result above 24 hours (1440 minutes) for one entry. The error is `INVALID_INPUT` with a next step that lists the formats.
4. **Command owns the flow, `progress` calls it.** `progress` step 8 keeps its question and then follows the steps of `/pmkit:issues:log-time` from its step 3 (the write and the total). That removes the second copy of the flow.
5. **Degradation.** When `time_tracking` is `absent`, the command writes the entry as a comment ("Time logged: 1h30 (90 minutes)") through `issues comment`, says so in a `note:` line and shows the `enableHint`. It never calls `issues log-time`. The comment path has no total, and the command says so.
6. **Total.** After a write on a tracker with time tracking, the command runs `issues time-entries <id> --json` and shows `total`.

## Non-goals

No change to the Local tracker store, to the event format or to `time-entries`. No new CLI command.

## Left to the builder

The exact wording of the command file and the error messages.
