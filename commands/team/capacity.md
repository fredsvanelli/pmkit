---
description: Capacity and days off per member for a sprint, with the effect on the load, and changes them after a preview
argument-hint: "[sprint <id>]"
disable-model-invocation: true
---

# Team capacity

Arguments: `$ARGUMENTS`

## Parameters

- `sprint <id>` (optional): the sprint to read and change, by its ID, or `current` for the active sprint. Without it, the command uses the active sprint. When no sprint is active, it stops.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team capacity [--sprint <id>] --json`. It reads the tracker and writes nothing. Show each entry of `notes` as a `note:` line, as the CLI wrote it, and each entry of `warnings`. The `note:` says where the numbers come from, for example that a Linear workspace keeps them in `.pmkit/capacity.yaml`.
2. Show one table with a row per member: member, availability, capacity (labeled with `unit`, `points` or `hours`, and no label when `unit` is `issues`), days off, working days, load and flags. A member whose `capacity` is `null` shows `not set`, which is not 0. When `flags` is `null`, the issue read is incomplete: say the load and flags are not verified and do not draw a conclusion from them. Capacity is the number of `unit` a member can take in the sprint. `availability` is the share of work set in the config, and this command does not change it. On Linear the members are those of the configured team, and agents (`agent:<name>`) are not members here.
3. Ask what to change with `AskUserQuestion`: capacity per member, days off per member, or neither. This is a choice, not a confirmation. Days off are weekdays inside the sprint, one date per day off. A capacity is a number, or `none` to remove it. `--days-off <member>=none` clears the days off of a member. When the user changes nothing, stop here. A change to the days off does not change the capacity, so say so and ask whether to change the capacity too.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team capacity [--sprint <id>] [--set <member>=<n>,<member>=<n|none>] [--days-off <member>=<date>+<date>,<member>=<date>] --dry-run --json`. Leave out the flag the user did not change. `--set` keeps the capacity of the members it does not name. When it fails with `INVALID_INPUT`, the whole batch was refused and nothing changed: show `error.message` and ask for a corrected value. The CLI checks the members, the dates (format, inside the sprint, weekday, repeated) and the numbers.
5. Show the preview. List each member in `changes` with the fields that change, as before and after: capacity and days off. Under it show `load`: the flags of each member before and after, and the imbalances. When `load.after` is `null`, say the effect of the change on the load is not verified. When `changes` is empty, say there is no change and stop. Show the `note:` lines of the result, and in particular the one that says a Linear workspace writes `.pmkit/capacity.yaml` and never writes Linear. A change to more than one member is a bulk change, so the preview is full and the question is always asked, whatever `write_policy.confirm` says. A change to one member obeys `write_policy.confirm`. Ask once with `AskUserQuestion`. When the user declines, change nothing.
6. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team capacity [--sprint <id>] [--set <member>=<n>,<member>=<n|none>] [--days-off <member>=<date>+<date>,<member>=<date>] --json`, which is the command of step 4 without `--dry-run`. All the members go in that one call, and the tracker writes them together, so a failure writes nothing. Show `error.message` and `error.nextStep` when it fails, and say that nothing was written.
7. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" team capacity [--sprint <id>] --json` again and show the table of step 2. On a Linear workspace, remind the user that `.pmkit/capacity.yaml` is a file to commit.

## Confirmation points

- Step 5: the full preview of the change, always asked for more than one member, whatever `write_policy.confirm` says. Declining changes nothing.
- Step 3 is a choice of changes, not a confirmation.

## Output

The table of step 2 and the notes. After a change, the list of members changed with their old and new capacity and days off, the flags before and after, and the table of step 7.

## If something is missing

- No active sprint, or a Linear team with cycles off: the CLI answers `NOT_FOUND`. Show `error.nextStep`, which is `/pmkit:cycle:plan` or `--sprint <id>`.
- The tracker has no estimates, or `estimation` is `absent`: `unit` is `issues`. The capacity is still a number the team chooses, and the table has no unit.
- A member that is an agent or not in the team: the CLI answers `INVALID_INPUT` with the valid members in `error.nextStep`. For an agent, say that `/pmkit:issues:delegate` hands an issue to an agent.
- A sprint that does not exist: the CLI answers `NOT_FOUND`. Show `error.nextStep`.
- An error from the CLI: apply the rules for reading errors in the conventions.
