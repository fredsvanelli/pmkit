# PMK-193: fix the edges of the log-time duration parser

Size: a small change. No project-level design was needed; this records the calls made.

## Intent

`/pmkit:issues:log-time` and its parser (PMK-60, PR #102) merged with four edge defects. Each one makes the output wrong or misleading for an unusual input.

## Goals

1. `parseMinutes` answers `INVALID_INPUT` for any duration that is not a safe integer number of minutes (`Number.isSafeInteger`), instead of passing `1e23` on.
2. `hoursText` writes a long duration with days: `100000` minutes is `69d10h40`, `1500` is `1d1h`.
3. On a real `issues log-time` write (no `--dry-run`) the more-than-a-day note says the time is already logged. The dry run and `issues parse-time` keep "check the time before you confirm", because nothing was written there.
4. The PMK-60 summary comment said "up to 24 hours", which is wrong since PMK-60 removed the ceiling. A correcting comment is posted on PMK-60 through the CLI.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`. No upper limit is added: any safe integer stays valid.

## Calls made (mine, no user answer was available)

- Too-large check runs on the raw value before rounding, with its own reason ("it is too large to be a whole number of minutes"), so `Infinity` from a very long digit string does not read as "not a whole number". Rounding to 6 decimals applies only to non-integers, so a safe integer is never changed by it.
- Day format follows the existing `1h30` style: `<d>d<h>h<mm>`, hours shown when hours or minutes are non-zero, minutes zero-padded and unit-less. Below one day the format is unchanged (`25h` is only ever seen above a day, so no existing short form changes).
- `longEntryNote(minutes, { written })`: the real-write path passes `written: true`. The JSON `note` carries the same text as stderr.
- The correction of the PMK-60 comment is a new comment, because a comment is not edited by hand under `.issues/`.
- The 24-hour wording in the README, CHANGELOG and command file stays: it names the threshold of the note, which is still 24 hours.
