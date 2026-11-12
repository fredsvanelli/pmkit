# PMK-267: unarchive history within one second, and the Linear flag check

## Problem

1. `parseEvents` (`scripts/lib/local/events.mjs`) keeps a flip back (archive then unarchive, or the reverse) within the second of the last kept event, as PMK-256 decided. A git merge that repeats an archive, unarchive, archive, unarchive run made within one second therefore keeps part of the copy.
2. `issues bulk unarchive` on Linear with a flag the command does not take (`--limit`) fails in `checkUsage` with the unknown-flag error, before `runBulk` can refuse with `NOT_SUPPORTED`.

## Design

1. Before the PMK-256 rule runs, group the archive and unarchive events by `at`. When a group is two equal halves (same events, same order, compared as the file compares duplicates), drop the second half. The PMK-256 rule then runs on what is left, so a single archive, unarchive, archive in one second, a lone repeated event and runs in different seconds behave as before.
   - Known ceiling: a real run that is two equal halves in one second (for example four flips) reads as a merge copy and shows two events. The final state is the same.
2. In `run`, before `checkUsage`, when the command is `issues bulk` and the change is `unarchive` and `tracker.system` is not `local`, throw `unarchiveNotSupported()`. The check in `runBulk` stays for other callers.

## Out of scope

Unarchive on Linear.

## Tests

- `scripts/events.test.mjs`: the 4-event run twice in one second shows 4 events; the 2-event run twice shows 2.
- `scripts/cli-bulk-linear.test.mjs`: `--limit 5` and an extra unknown flag answer `NOT_SUPPORTED`.
