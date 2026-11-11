# PMK-256: unarchive edge cases (design)

Follow-up of PMK-250 (PR #205). Four edge cases, Local tracker and the Linear refusal.

## Decisions

1. **History after a merge that repeats a flip sequence.** `parseEvents` (`scripts/lib/local/events.mjs`) keeps a repeated archive or unarchive event only when the toggle flipped. A merge that repeats a whole archive, unarchive, archive, unarchive run flips the toggle at each line, so all of it stayed. New rule: a repeated flip event is a real new event only when the previously kept event has the same `at`, which is the one case the toggle rule exists for (several flips within one second). A repeat that comes after an event with another time is a merge duplicate and is dropped. Ceiling: a merge that duplicates a run made entirely within one second still keeps part of it; the final state stays right.
2. **View without `archived`.** `checkBulkFilter` in `scripts/lib/bulk.mjs` takes the next step from `viewName`: with a view it says to save the view with `--archived` (`pmkit views save <name> ... --archived --overwrite`); without one it keeps "Add --archived to the filter".
3. **Linear refuses first.** `runBulk` in `scripts/pmkit.mjs` answers `NOT_SUPPORTED` for `unarchive` on any non-Local tracker before it reads the tracker, parses the change, checks `--max` or the view. The error is built once, by `unarchiveNotSupported()` in `scripts/lib/errors.mjs`, which `linear/tracker.mjs` also uses.
4. **Limits count archived issues only.** On the Local tracker the archived filter already runs before the `hasMore` and `--max` checks, so no code changes; a regression test with more live matches than `--max` locks it in. Linear never reaches the check (decision 3).

## Out of scope
A bulk unarchive with no narrowing filter.
