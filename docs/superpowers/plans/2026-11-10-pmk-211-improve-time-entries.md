# PMK-211 plan

Spec: `docs/superpowers/specs/2026-11-10-pmk-211-improve-time-entries-design.md`. Every commit subject ends with `(PMK-211)`.

1. Shared rule (criterion 1). Test in `scripts/duration.test.mjs`: `isPositiveMinutes` true for 1, 90; false for 0, -1, 1.5, '5', NaN. Add it to `duration.mjs`, use it in `logTime` and `listTimeEntries` of `scripts/lib/local/tracker.mjs`, and in `pmkit.mjs` only if it repeats the check.
2. Contract (criterion 2). In the `logs time` case of `scripts/contract-suite.mjs` assert `listed.ignored === 0`.
3. Readable time (criterion 5). Test `formatMinutes` (45 -> 45m, 60 -> 1h, 90 -> 1h30, 1500 -> 1d1h). Export it from `duration.mjs` (reuse `hoursText`), add `time` to entries and `totalTime` in `listTimeEntries`, add a Time column and total line in the `time-entries` text.
4. Totals (criterion 3). Test in the local tracker tests: two people, entries in two sprints and one outside. `listTimeEntries` adds `byPerson` and `bySprint`; text prints both blocks.
5. progress (criterion 4). `commands/issues/progress.md` step 8 runs `issues time-entries <id> --json` first, shows `total`/`totalTime` and `ignored`; update `scripts/__scenarios__/issues-progress.mjs` and its `.after.txt`, plus scenario counts if they change.
6. Docs: CHANGELOG line, README row for `issues time-entries`, `skills/pmkit/SKILL.md` if it lists the command, `log-time.md` step 5 mentions `totalTime`. Regenerate goldens. Tick criteria 1-5, commit `.issues/`.
7. `npm test` in the foreground, exit 0. Then PR.
