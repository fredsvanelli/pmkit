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
6. Propose what to do with each unfinished issue. The options are move it to a planned sprint (find one with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle list --state planned --json`), move it back to the backlog, or split it. A split means creating a new issue for the remaining work and reducing the estimate of the original. Say when no planned sprint exists.
7. Show the sprint report with the numbers and the proposal, then ask with `AskUserQuestion` for the decision per unfinished issue. For the moves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <ids> --to <next sprint id> --dry-run --json` and, for the backlog moves, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <ids> --to none --dry-run --json`. For a split, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <original type> --estimate <n> --parent <original parent> [--priority <original priority>] [--label <original labels>] --dry-run --json`. Leave out `--parent` when the original issue has no parent. Add `--priority` and `--label` when the original has them, with the labels comma-separated. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --estimate <n> --dry-run --json` to reduce the estimate of the original. The original stays in the closed sprint with the reduced estimate, and the new issue goes to the backlog, because the create call sets no sprint. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --dry-run --json` as well. Moving issues between sprints is a scope move and closing ends the sprint, so show one full preview of all of it and ask once, whatever `write_policy.confirm` says. When the user declines, change nothing.
8. After the approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle close <sprint id> --json`, then the same moves and splits without `--dry-run`. When one fails, stop, list what was done and what was not, and do not retry it.
9. Offer a retro document. Draft it from the numbers and the retro prompts (what slipped and why, based on the data). Write it to a temporary file outside `.issues/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" docs create retros/<sprint id>.md --body-file <file> --dry-run --json`, show the document and ask once. When the user declines, skip it. After approval, run it without `--dry-run`.
10. Remove the temporary files.

## Confirmation points

- Step 1: the preview of `pr sync` when it would move issues. Declining leaves them as they are.
- Step 7: the decision per unfinished issue, then one full preview of the moves, the splits and the close, always asked because it holds scope moves. Declining changes nothing.
- Step 9: the retro document, shown with its dry run and asked once before it is written. Declining skips it.

## Output

The sprint report. Lead with delivered against planned (count and estimate), then scope added and removed, carry-over, cycle time (median and p85) and throughput. Then the retro prompts from the data, the moves applied and the path of the retro document, if written.

## If something is missing

- No active sprint and no ID: say so and offer `/pmkit:cycle:plan`.
- No unfinished issues: close without moves.
- No planned sprint: offer the backlog or a split, or ask whether to close and plan afterward with `/pmkit:cycle:plan`.
- The git host is `none`: skip PR data and say so in one line.
- An error from the CLI: apply the rules for reading errors in the conventions.
