---
description: Issues, estimates and work in progress per member, with imbalances and members with no work, and reassigns after a full preview
argument-hint: "[sprint <id>]"
disable-model-invocation: true
---

# Team load

Arguments: `$ARGUMENTS`

## Parameters

- `sprint <id>` (optional): the sprint to read, by its ID, or `current` for the active sprint. Without it, the command reads the active sprint. When the tracker has no active sprint, it reads every open issue in `todo`, `in_progress` or `in_review`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team load [--sprint <id>] --json`. It reads the tracker and writes nothing. Show each `note:` line as the CLI printed it, because it says which path the numbers took: counted issues instead of estimates, no active sprint, or where the capacity came from. Show each warning.
2. Show one table with a row per member and these columns: member, issues, the estimate total (labeled with the unit, `points` or `hours`; `?` when the load is unknown), work in progress, oldest work in progress in days, capacity and flags. Leave out the estimate and capacity columns when `unit` is `issues`. A member with open issues and no estimate has a `?` load and stays out of the average and the proposed moves, and the `note:` says how many there are. A member with some issues unestimated shows `(partial)`: the estimate total is a lower bound, so the member is never a move target. On Linear the members are those of the configured team, and an assignee from another team has a row marked `(not a member)`. Add the `unassigned` row. Then list the `imbalances` (`over_average` is a load above 1.5 times the average of the human members, `over_capacity` is more estimate (points or hours) than the sprint capacity) and the members in `noWork`, each with the days off the sprint gives them. Agent members (`agent:<name>`) show as rows, and stay out of the average, the imbalances and `noWork`. Say so in one line when the tracker has one.
3. List the `suggestions`, which are proposed moves of issues in `todo` from an overloaded member to the member with the lowest load. When there is none, say so, and show `noMoves.message` from the JSON when `noMoves` is not null. Its `reason` is `no_candidates` (the overloaded members have nothing in `todo`), `unestimated` (what they have in `todo` has no estimate, so a move cannot be sized) or `no_target`. When `truncated` is true, the CLI warned that the issue read was cut and proposed nothing, so do not offer moves. Ask with `AskUserQuestion` whether to reassign: the user accepts the suggestions, names other moves, or declines. This is a choice of moves, not a confirmation. When the user declines or there is nothing to move, stop here.
4. Check each move. The target must be a human member of the tracker. An agent member is not a target: say that `/pmkit:issues:delegate` hands an issue to an agent, and drop the move. An issue that is `done` or `canceled` is not a move either.
5. Preview every move. For each issue run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues assign <id> <member> --dry-run --json`. Show all of them together as a table with ID, title, status, estimate, current assignee and new assignee, and under it the load per member before and after the moves. Ask once with `AskUserQuestion`, whatever `write_policy.confirm` says, because a reassignment is a bulk change. A single move gets the same preview. When the user declines, change nothing.
6. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues assign <id> <member> --json` for each move, which is the command of step 5 without `--dry-run`. When one fails, stop, list the issues already reassigned and the ones left, and apply the rules for reading errors in the conventions.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team load [--sprint <id>] --json` again and show the table of step 2.

## Confirmation points

- Step 5: the full preview of the reassignments, always asked. `write_policy.confirm: none` does not skip it. Declining changes nothing.
- Step 3 is a choice of moves, not a confirmation.

## Output

The table of step 2, with every issue and member in full, the imbalances and the members with no work. After a reassignment, the table of step 7 and the list of issues moved, each with its old and new assignee.

## If something is missing

- The tracker has no estimates, or `estimation` is `absent`: the CLI counts issues and prints a `note:`. Repeat it.
- No active sprint, or a tracker without sprints: the table covers all open work, and the note says so. Capacity and days off are empty.
- No member holds work: say so, and list the unassigned issues.
- A `sprint` that does not exist: the CLI answers `NOT_FOUND`. Show `error.nextStep`.
- An error from the CLI: apply the rules for reading errors in the conventions.
