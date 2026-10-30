# PMK-51: list the time entries of an issue

Epic: EPC-6 (Remaining generic commands). Source: the MVP skills spec, "Contract operations the MVP needs", row Time: `list_time_entries` is marked not yet.

## Intent

`pmkit issues log-time` writes `log_time` events, but nothing reads them back. A user who logs time wants to see what was logged on an issue and the total. This change adds the read side.

## Goals

- A CLI command lists the `log_time` events of one issue, with the total in minutes.
- The read goes through the tracker contract, like every other command, so Linear answers the same way it answers `logTime`.
- The output works for people (a table and a total line) and for scripts (`--json`).

## Non-goals

- No editing or deleting of time entries.
- No totals per person, per sprint or per epic. The data allows it; the issue does not ask for it.
- No change to how `log_time` is written.

## Decisions

These are my calls, made without a live user. Each one can be reversed before the plan starts.

1. **Contract operation `listTimeEntries(id)`.** It is the spec's `list_time_entries`. It goes into `TRACKER_OPERATIONS` and returns the `log_time` events of the issue, oldest first, as `{ at, by, minutes }`. Reading `getHistory` in the CLI would work on Local, but on Linear it would return an empty list and print "0 minutes", which is false because Linear cannot record time at all.
2. **Linear refuses.** `listTimeEntries` joins the Linear `STUB_CAPABILITY` map under `time_tracking`, so it answers `NOT_SUPPORTED` with the manifest hint, as `logTime` does.
3. **Command name `issues time-entries <id>`.** It follows `issues log-time` and the contract name. It takes no flags beyond the global `--json`.
4. **Output.** Text: a table with the columns At, By and Minutes, then `total: N minutes`. With no entries: `no time logged on <id>` and `total: 0 minutes`. JSON: `{ "issue": "<id>", "entries": [{ "at", "by", "minutes" }], "total": <minutes> }`.
5. **Order.** Oldest first, the order of the events file, which matches the spec's creation-order rule for lists.
6. **Capability.** `time-entries` is added to `SERVED_BY.time_tracking`, next to `issues log-time`. The capability goldens print only the path, so they do not change.

## Out of scope for this change

- `/pmkit:issues:progress` keeps logging time as it does. It does not start reading the list.
- The MCP surface, if one exists, gets the operation through the contract later.

## Test plan

- `scripts/tracker-comments.test.mjs` or a new block beside it: `listTimeEntries` returns the logged entries in order and the total, and an issue with none returns an empty list.
- `scripts/cli.test.mjs`: the command prints the table and the total, and `--json` returns the shape above.
- `scripts/contract-suite.mjs`: a `time` case that logs and lists; the Linear run skips it through the `time` family, as the `log_time` case already does.
- `scripts/golden-cases.mjs`: a golden case for `issues time-entries` in the fixtures that have time events, regenerated with `UPDATE_GOLDENS=1`.
- Linear: `scripts/lib/linear/tracker.test.mjs` refuses `listTimeEntries` with `NOT_SUPPORTED` and sends no request, as the `logTime` test does.
