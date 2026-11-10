# PMK-211 Improve issues time-entries: design

Source: PMK-51 follow-ups (`docs/superpowers/epc-6-follow-ups.md`). No question went to the user; the calls below are the implementer's.

## Goals

1. One "positive integer" rule for minutes, shared by `logTime` and `listTimeEntries` (`isPositiveMinutes` in `scripts/lib/duration.mjs`).
2. `scripts/contract-suite.mjs` checks `ignored` (0 for clean entries).
3. `listTimeEntries` returns totals per person (`byPerson`) and per sprint (`bySprint`); `time-entries` prints them.
4. `/pmkit:issues:progress` step 8 reads `time-entries` so the user sees the time already logged before answering.
5. `time-entries` shows readable time (`1h30`) next to minutes, in text and in `--json` (`time`, `totalTime`).

## Calls made (checkable)

- Sprint attribution: an entry belongs to the sprint whose `start`..`end` (inclusive, `YYYY-MM-DD`) holds the UTC date of its `at`. Several matches: the first by start date. No match: `sprint: null` ("no sprint"). The entry's date, not the issue's current sprint, so a moved issue keeps its history.
- `byPerson` and `bySprint` are lists, in order of first appearance, each `{ by|sprint, minutes, time }`; their sums equal `total`.
- Readable form: `45` is `45m`, `60` is `1h`, `90` is `1h30`, 1500 is `1d1h` (same rule as the over-a-day note). Minutes stay in the JSON.
- Linear: unchanged, `time_tracking` is `absent` and `listTimeEntries` already refuses with `NOT_SUPPORTED`.
- A sprint file that does not parse is skipped and sets `sprintsUnread`; the other sprints still count. Sprint files are read only when there is an entry. The `at` is read with `eventInstant` (a zone is converted to UTC; a value that is no date, such as a number, counts for no sprint).

## Non-goals

No new command, no flag, no change to `log-time`, no per-sprint filter.
