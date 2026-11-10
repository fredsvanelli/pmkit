# PMK-227: improve log-time (design)

Date: 2026-11-10. Issue: PMK-227 "Improve log-time". Source: PMK-60, collected in `docs/superpowers/epc-6-follow-ups.md`.

## Intent

PMK-60 shipped `/pmkit:issues:log-time`. Its reviewers asked for two follow-ups. Neither is a defect.

## Goals

1. A scenario that runs `/pmkit:issues:log-time` against a Linear fixture on the comment path. On Linear, `time_tracking` is `absent`, so step 6 reads the time with `parse-time`, previews a comment, asks once and posts it. No time entry is written.
2. Make `progress` step 8 follow `log-time` directly, but only if scenario rule 5 (every call of a step matches a call of the same step) is relaxed.

## Non-goals

- Changing `log-time` behaviour. The comment path already matches the command text.
- Relaxing scenario rule 5. Nothing in this issue asks for it.
- The defects found in the same reviews. Those are separate bug issues.

## Decisions (made without the user, per the coordinator brief)

- **Goal 1, Linear fixture:** a second entry in `scripts/__scenarios__/issues-log-time.mjs`, using the fake Linear API the estimate scenario already uses (`scripts/fake-linear-api.mjs`). The entry is ACME-2 with `1h30`. Its skips name the steps that do not run on this tracker (4, 5 for `log-time` and `time-entries`). Its `expect` asserts `time_tracking` is `absent`, the parsed minutes are 90, and no `log_time` event is written. The comment body is `_inputs/log-time-comment.md`.
- **Goal 2, progress step 8:** not done. The condition is "if rule 5 is relaxed", and it is not. Rule 5 stays strict, so `progress` step 8 keeps its own calls (`time-entries`, then a dry run and a write of `log-time`). The acceptance criterion stays unchecked, and the report says why.
- **Snapshots:** the export of `issues-log-time.mjs` becomes an array, so the snapshots are `issues-log-time.0.after.txt` (Local) and `issues-log-time.1.after.txt` (Linear). The old `issues-log-time.after.txt` is removed.
- **Builder check:** not dispatched as a subagent (the brief forbids helper workers). The spec was checked by reading it against the command file and the scenario rules.

## Verification

- `node --test scripts/scenarios.test.mjs` passes, and the new entry passes rules 5 to 11 against the existing command text.
- `npm test` passes with exit code 0 before the PR opens.
