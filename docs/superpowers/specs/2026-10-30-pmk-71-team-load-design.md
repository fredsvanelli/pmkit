# PMK-71 design: the team-load command

Source: Unified model, EM catalog (`team-load`: "Issues, estimates and WIP per person; reassigns"; degradation "Issue count"); Linear tab ("imbalances, people with no work in the cycle").

This design was written without a round of questions. The calls the builder made are listed in "Decisions", and each one can change in review.

## Goal

- A read-only CLI command, `pmkit team load`, that returns the open work of each member: issues, estimates (points or hours), work in progress and the oldest work in progress.
- A command file, `/pmkit:team:load`, that shows the result, flags imbalances and members with no work, and reassigns issues after a full preview.
- The calculation lives in `scripts/lib/team-load.mjs`, a pure module. PMK-72 (team-capacity) reuses it.

## Non-goals

- No new write operation. Reassigning calls `issues assign` once per issue.
- No change to the Local tracker store or to `scripts/lib/capabilities.mjs`.
- No time-based load (hours logged) and no forecast.

## The CLI command

`pmkit team load [--sprint current|<id>]`. It reads `cycle current` (or the sprint named), `cycle issues`-equivalent data from `searchIssues`, `getCapacity`, `getDaysOff` and `metrics aging` inputs (`metricEvents`, `aging` from `scripts/lib/metrics.mjs`).

Scope:

- A sprint is in scope when `--sprint` names one, or when the tracker has cycles and one is active. The scope is the open issues of that sprint (categories `todo`, `in_progress`, `in_review`).
- Without a sprint (the `no-sprints` fixture, a Linear team with cycles off, or no active sprint), the scope is every open issue in `todo`, `in_progress` or `in_review`. A `note:` says so.
- Backlog and triage issues are not load, because nobody has started or committed to them.

Per member the result has `issues`, `estimate` (the sum of the estimates), `unestimated`, `wip` (issues in `in_progress` or `in_review`), `oldestWipDays`, and, when a sprint is in scope, `capacity` and `daysOff`.

Unit: the unit is the estimate unit of the tracker, `points` or `hours`, when the `estimation` capability is not `absent` and at least one issue in scope has an estimate. Otherwise the unit is `issues` and a `note:` says why: "estimates are off", "no issue in scope has an estimate", or, for t-shirt sizes (`sizes`), "estimates are sizes and do not add up". A `conditional` estimation (Linear teams that differ) follows what the issues carry. With an estimate unit, `unestimated` counts the issues without an estimate on each row and a warning names the total.

Members:

- Human members come from `discover().members`, in config order. A member with no open work shows a row of zeros, and is listed in `noWork`.
- Unassigned issues form one row, `unassigned`, outside the average and the flags.
- Agent members (`agent:<name>`, PMK-57) show as rows with `agent: true`. They are counted in neither the average, nor `noWork`, nor the imbalance flags, and are never a reassign target. An agent does not have a capacity or a workload the team manages, and delegation to an agent has its own command (`/pmkit:issues:delegate`).
- An assignee that is not a member (for example a Linear user that left) shows as a row with `isMember: false`. Like an agent, it stays out of the average and the flags, and is never a target.

Imbalances (`imbalances`), computed on the unit's load among human members who are members:

- `over_average`: load above 1.5 times the average of the human members, when there are at least two of them and the average is above 0.
- `over_capacity`: estimates above the sprint capacity of the member, only with an estimate unit and a capacity.

`noWork` lists the human members with no open issue in scope, counted by issues and never by estimate, with their days off in the sprint. Members with `availability` 0 are skipped.

Unknown load (decided in the review of PR #92): with an estimate unit, a member who has open issues and none estimated has an unknown load (`load: null`, `unknown: true`). That member stays out of the average, out of `over_average` and out of `noWork`, and is never a reassign target. A `note:` says how many members are in that state, and `unknownLoad` lists them. Partial load (decided in the second review of PR #92): a member with some open issues unestimated and some estimated has a known lower bound, so the row is marked `partial: true` and the text shows `(partial)`. The sum still counts in the average and in the flags, but a partial member is never a reassign target, because the real load is unknown. The warning "some issues have no estimate and count 0 <unit>" skips the issues of members whose load is unknown. Members on Linear are those of the configured team (`tracker.scope.team`); an assignee from another team has a row marked not a member, outside the average and never a target. `--sprint current` means the active sprint, as in `issues list`. The comparison with 1.5 times the average uses the unrounded average, and only the output rounds, to 2 decimals.

Suggestions (`suggestions`): `suggestMoves` moves issues in `todo` (not started) from members flagged `over_average` or `over_capacity` to the human member with the lowest known load, one issue at a time, largest estimate first. A member that is `over_average` or `over_capacity` is never a target. A move leaves the target at or below the source, does not pass the overload limit (1.5 times the average, computed with the sum as `over_average` is, so the same comparison), and stays at or below the target's own capacity. When a flagged member has issues in `todo` and no target is left, the proposal is empty. `suggestMoves` is built on `proposeMoves`, which also returns the reason, and the CLI puts it in `noMoves` (`{ reason, message }`, or `null`) and in the text: `no_candidates` when the flagged members have nothing in `todo`, `unestimated` when what they have in `todo` has no estimate, `no_target` otherwise (review of PR #92, cycles 3 to 5). A source stops giving at the average (`over_average`) or at its capacity (`over_capacity`). It is a proposal only. Nothing is written. When the issue read comes back cut (`hasMore`), the command warns and proposes nothing. Without an active sprint on a Linear team with cycles off, the `cycles` note shows, and `--sprint <id>` answers `NOT_SUPPORTED`.

The command prints a table (member, issues, estimate in the unit, WIP, oldest WIP days, capacity, flags), then the `noWork` and `suggestions` lines. `--json` returns the whole object.

## The command file

`commands/team/load.md`, `/pmkit:team:load [--sprint <id>]`. Steps:

1. Run `team load --json` and show the table and the notes. Lead with the imbalances and the members with no work.
2. Offer the suggestions when there are any, or let the user name the moves. Without a request, stop here.
3. Reassign. Run `issues assign <id> <member> --dry-run --json` for each issue, show the full preview (every issue, before and after of the assignee) and ask once, whatever `write_policy.confirm` says, because it is a bulk change (conventions, "Write policy"). A single issue also gets the full preview, so the command has one rule. On approval, run the same calls without `--dry-run`. On a refusal, change nothing.
4. Run `team load --json` again and show the table after the change.

## Decisions

- A new CLI command instead of calculating in the command file: PMK-72 needs the same numbers, and a pure module has unit tests.
- Open work only, in `todo`, `in_progress` and `in_review`. Done issues of the sprint are not load.
- Agents sit outside the balance (see Members).
- The threshold of 1.5 times the average is a constant in the module, with no config key. A config key is a follow-up.
- Reassigning always asks, even for one issue.
- Capability: no new row. The command uses `cycles`, `estimation`, `capacity` and `native_metrics` notes that already exist, so `SERVED_BY` and the ADR-0001 counts do not change. It runs on Linear through the same contract operations, and a Linear team with cycles off falls back to the no-sprint scope.

## Tests

- Unit tests for `scripts/lib/team-load.mjs`: load per member, unit choice, agents, non-members, imbalances, no work, suggestions.
- CLI tests: Local on `team`, `no-sprints`, estimation off, and the read list in `cli.test.mjs`.
- A scenario `scripts/__scenarios__/team-load.mjs` with its snapshot, the counts of command files (each new command file adds one), `COMMANDS.team` in `plugin.test.mjs`, the README and skill tables, and the CHANGELOG line.
