---
description: Plan the next sprint from velocity, capacity and the prioritized backlog
argument-hint: "[goal]"
disable-model-invocation: true
---

# Plan a sprint

Arguments: `$ARGUMENTS`

## Parameters

- `goal` (optional): the sprint goal. Without it, the command proposes one from the selected issues.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle list --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`. Read `defaults` and the members' `availability` from `.issues/config.yaml`. When a sprint in state `planned` exists, ask with `AskUserQuestion` whether to plan that one. When the user says yes, use its ID and skip the creation in step 7.
2. Compute the dates. The start is the first `defaults.sprint_start_weekday` (Monday when missing) after the `end` of the last sprint, or after today when there is no sprint. The end comes from `defaults.sprint_length_days` unless the user gives one. Count the working days, Monday to Friday, between them.
3. Compute velocity. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" metrics velocity --window <defaults.velocity_window> --json`. When `perSprint` is empty, there is no history. Ask with `AskUserQuestion` for a target number of points or issues, and say the plan uses that target.
4. Compute each member's capacity. Ask for each member's days off in this sprint, as dates. Days off must be weekdays inside the sprint dates, one date per day off. Step 7 stores them. Take the points per working day as the average velocity divided by the working days of a sprint times the sum of all members' `availability`. A member's capacity is that rate times `availability` times (working days minus days off), rounded to a whole number. Say the numbers come from this formula.
5. Draft the scope. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category todo,backlog,in_progress --sprint none --json`. Keep the issues in creation order, oldest first, as the CLI returns them, and move each blocker before what it blocks. Skip an issue whose blocker is not done and not in the selection. Add issues until the total estimate reaches the team capacity. Flag every issue with no estimate and leave it out of the total. Draft a goal from the selected issues, or use the one given.
6. Show the capacity inputs: the dates, the goal, the days off, the capacity per member and the team total against the velocity. Ask with `AskUserQuestion` whether to open the sprint with these. Let the user change a number. When the user declines, stop and change nothing.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle open --start <date> --end <date> --goal "<goal>" --dry-run --json` and show the sprint. When it fails, show the error and ask for a corrected value. After the approval of step 6, run it without `--dry-run`. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle capacity <id> --set <member>=<n>,<member>=<n> --days-off <member>=<date>+<date>,<member>=<date> --json`, with the numbers and dates the user approved. Leave out a member with no days off. When the command fails, show the error and ask for a corrected date.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle add <id1> <id2> ... --to <sprint id> --dry-run --json` for the draft scope. Adding issues to a sprint is a scope move, so show the full preview and ask with `AskUserQuestion`, whatever `write_policy.confirm` says. The preview is a table (ID, title, status, estimate, assignee, blocked by) with the committed estimate against capacity and the risks of the Output section. Let the user add or remove issues, then run the dry run again. When the user declines, leave the sprint open and empty, and say so.
9. After the approval, run the same command without `--dry-run`.

## Confirmation points

- Step 1: whether to plan an existing `planned` sprint.
- Step 6: the capacity inputs and the sprint dates and goal, before the sprint is created. Declining stops the command with nothing written.
- Step 8: the full scope, always asked because it is a scope move. Declining leaves the sprint open with no issues.

## Output

The sprint plan. It has the goal, the dates, the issues with their estimates, the committed estimate against capacity and the velocity it came from, for example "velocity computed from the last 3 sprints". List the risks after it. They are the unestimated issues, the issues with a blocker outside the sprint, and any member whose assigned estimate is above their capacity.

## If something is missing

- No closed sprint: the plan uses the target the user gave and says so.
- No estimates in the backlog: plan by issue count against the target.
- An empty backlog: open the sprint with no issues only when the user asks.
- An error from the CLI: apply the rules for reading errors in the conventions.
