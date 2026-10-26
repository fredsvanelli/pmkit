---
description: Close the active sprint, report planned against delivered, and move the unfinished issues
argument-hint: "[sprint-id]"
disable-model-invocation: true
---

# Close a sprint

Arguments: `$ARGUMENTS`

## Parameters

- `sprint-id` (optional): the sprint to close. Without it, the command closes the active sprint.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it.
2. Find the sprint. Without an ID, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle current --json`. When none is active, stop and say so.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json`. The issues in `done` are delivered, and the rest are unfinished.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" events --since <start> --until <end> --json`, with the sprint's dates. Compute these from the events and the issues, and say they come from the event log.
   - Planned: the issues in the sprint at its start. Scope added: issues whose `sprint` field changed to this sprint after the start. Scope removed: issues that left it.
   - Delivered against planned, by count and by estimate.
   - Carry-over: the unfinished issues, and the issues that were in `in_progress` in more than one sprint.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics cycle-time --since <start> --until <end> --json` for the median and p85 days. Throughput is the number of issues done.
6. Propose what to do with each unfinished issue. The options are move it to a planned sprint (find one with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle list --state planned --json`), move it back to the backlog, or split it. A split is for an issue with an estimate and a delivered part. Step 7 asks for the delivered part as an estimate. The split runs only when that number is greater than 0 and lower than the original's estimate. The original keeps the delivered part: its estimate drops to that number, it moves to `done`, and it stays in the closed sprint. A new issue in the backlog takes the remaining work, with a `related` link to the original. Do not offer a split for an issue with no estimate, and say so. When the user gives 0, or a number not lower than the original's estimate, say why no split runs and offer the two moves. When the user declines a split, the issue stays as it is and does not move to `done`. Say when no planned sprint exists.
7. Show the sprint report with the numbers and the proposal. The report's delivered numbers are those of steps 3 and 4, before any write. Step 8 reads them again after the writes. Then ask with `AskUserQuestion` for the decision per unfinished issue. For the moves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <ids> --to <next sprint id> --dry-run --json` and, for the backlog moves, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <ids> --to none --dry-run --json`. For a split, the new issue's estimate is the original's estimate minus the delivered part, and the original's estimate becomes the delivered part. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <original type> --estimate <remaining> --parent <original parent> [--priority <original priority>] [--label <original labels>] --dry-run --json`. Leave out `--parent` when the original issue has no parent. Add `--priority` and `--label` when the original has them, with the labels comma-separated. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <delivered> --dry-run --json` to reduce the estimate of the original to the delivered part, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> done --dry-run --json` to mark it delivered.
   - The original stays in the closed sprint as done, and the new issue goes to the backlog, because the create call sets no sprint.
   - Show the `related` link of step 8 between the two.
   - List what stays on the original once it is done, using the step 3 read: the IDs in its `blockedBy` and `children` whose status category is not `done`, and its acceptance criteria with `done: false`. For a blocker or sub-issue outside the sprint, list its ID and say its status was not read. The close does not move or copy them.

   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --dry-run --json` as well. Moving issues between sprints is a scope move and closing ends the sprint, so show one full preview of all of it and ask once, whatever `write_policy.confirm` says. When the user declines, change nothing.
8. After the approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`, then the same moves and splits without `--dry-run`. For each split, run the create first and note the new ID. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <original id> --kind related --json`, then the estimate update and the move to `done` of the original. The approval of step 7 covers the link, because the preview showed it. When one fails, stop, list what was done and what was not, and do not retry it. After the last write, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle issues <sprint id> --json` again. Delivered is the issues of this read whose status category is `done`: their count, and the sum of their `estimate`. Throughput is the same count. Planned stays the step 4 number, with the estimates of the step 3 read. Scope added and removed and cycle time keep the numbers of steps 4 and 5. Carry-over keeps the step 4 list, with the decision applied to each unfinished issue and the new ID of each split.
9. Offer a retro document. Draft it from the numbers of step 8 and the retro prompts (what slipped and why, based on the data). Write it to a temporary file outside `.issues/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create retros/<sprint id>.md --body-file <file> --dry-run --json`, show the document and ask once. When the user declines, skip it. After approval, run it without `--dry-run`.
10. Remove the temporary files.

## Confirmation points

- Step 1: the preview of `pr sync` when it would move issues. Declining leaves them as they are.
- Step 7: the decision per unfinished issue, then one full preview of the moves, the splits (the new issue, its link, the reduced estimate, the move of the original to `done`, and the open blockers, sub-issues and criteria that stay on it) and the close, always asked because it holds scope moves. Declining changes nothing.
- Step 9: the retro document, shown with its dry run and asked once before it is written. Declining skips it.

## Output

The delivered numbers and throughput come from the `cycle issues` read of step 8, after the writes. The sprint report. Lead with delivered against planned (count and estimate), then scope added and removed, carry-over, cycle time (median and p85) and throughput. Then the retro prompts from the data and the moves applied. For each split, the new issue's ID and the original's delivered estimate. Then the path of the retro document, if written.

## If something is missing

- No active sprint and no ID: say so and offer `/pmkit:cycle:plan`.
- No unfinished issues: close without moves.
- No planned sprint: offer the backlog or a split, or ask whether to close and plan afterward with `/pmkit:cycle:plan`.
- A split of an issue with no estimate, or with a delivered part of 0 or not lower than its estimate: offer a move to a planned sprint or to the backlog instead, because a split moves the original to `done` with a lower estimate.
- The git host is `none`: skip PR data and say so in one line.
- An error from the CLI: apply the rules for reading errors in the conventions.
