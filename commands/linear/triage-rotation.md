---
description: See who is on triage duty in Linear, change the rotation, and read Linear's Triage Intelligence suggestions
argument-hint: "[show|set|suggestions]"
disable-model-invocation: true
---

# Linear triage rotation

Arguments: `$ARGUMENTS`

## Parameters

- `show`, `set` or `suggestions` (optional): where to start. Without it, the command shows who is on duty, then the suggestions, and asks what to do next.
- A team key (optional): the team to work on. Without it, the command uses the team in `.pmkit/config.yaml`, or the only team of the workspace.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `linear`, say that this command works only with the Linear tracker and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear triage show --json`, with `--team <key>` when the user named a team. When `available` is false, print `reason`, `plan` and `enableHint`, say that the workspace may need `pmkit discover` after an upgrade, and stop.
3. Show who is on duty (`duty.current`), the action (`assign` or `notify`), the source and the rotation. When the source is `schedule`, show the provider and the schedule name, and say that pmkit does not change a schedule. When the source is `none`, say that nobody is on triage duty.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear triage suggestions --json` and show the suggestions per issue with the score and the reasons. Label them as Linear's suggestions and say that applying one is a normal issue edit. Show each warning, such as the issues left out by `--limit`.
5. Ask with `AskUserQuestion` what to do next. The choices are change the rotation, change the action, turn the responsibility off, or stop. When the user stops, change nothing.
6. For a change, get the member ids from `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear triage set --members <id,id> --dry-run --json`, or `--action <assign|notify>` or `--off` in place of `--members`. Show `before` and `after` and ask once with `AskUserQuestion` whether to apply it, whatever `write_policy.confirm` says, because the change decides who receives new triage issues. When the user declines, change nothing.
7. After approval, run the same `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" linear triage set --members <id,id> --json` call without `--dry-run`. Then run `linear triage show --json` again and compare it with the preview. When they differ, say how.

## Confirmation points

- Step 5: the next action. Stopping changes nothing.
- Step 6: the preview of the change, always asked because it decides who receives new triage issues. Declining changes nothing.

## Output

The team, who is on duty now, the action, the rotation, the suggestions per issue, and what changed with the state before and after.

## If something is missing

- No `LINEAR_API_KEY`: the CLI fails with `AUTH`. Apply the rules for reading errors in the conventions.
- A Local tracker: stop at step 1.
- A Free or Basic workspace, or a team with triage off: stop at step 2 and give the `enableHint`.
- A rotation that comes from a schedule: `set --members` fails with `CONFLICT`. Say to change the schedule in Linear, or offer `--off` or `--action`.
- An error from the CLI: apply the rules for reading errors in the conventions.
