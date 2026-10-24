---
description: Draft a status update for an epic and publish it after you approve
argument-hint: "<epic-id>"
disable-model-invocation: true
---

# Epic status report

Arguments: `$ARGUMENTS`

## Parameters

- `epic-id` (required): the epic, for example `EPC-2M9D`. When it is empty, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic list --json`, show the epics and ask which one with `AskUserQuestion`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <epic-id> --json`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic progress <epic-id> --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <epic-id> --json`.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic updates <epic-id> --json`. The first entry is the last update. Its date is the start of the period. Without an update, the period is the last `defaults.status_update_window_days` days (14 when missing in `.issues/config.yaml`), and the report says so.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" events --since <start of the period> --json`. Keep the events of the epic's issues. List what moved to `done`, what was created, and what is blocked, which means open issues with a `blockedBy` issue that is not `done` or `canceled`.
5. Compute progress from `epic progress`, by count (`done` of `total`) and by estimate (`pointsDone` of `points`). Compare the share done with the time elapsed between `start` and `target`, and say whether the target date looks reachable. Say it is an estimate from the pace of the period.
6. Draft the update with a proposed health, `on_track`, `at_risk` or `off_track`, and the reason in one sentence. Write it to a temporary file outside `.issues/`. It has the progress numbers, what changed, what is blocked and the forecast against the target date.
7. Publishing a status update always shows the full draft and asks. Show the draft and the health, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic update-status <epic-id> --health <health> --body-file <file> --dry-run --json` and show the result. Ask with `AskUserQuestion` whether to publish, with the options to publish, to change the health or the text, or to not publish. Show the draft again after a change. When the user declines, stop and publish nothing. Offer the draft as text to copy.
8. When the user approves, run the same command without `--dry-run`.
9. Remove the temporary file.

## Confirmation points

- Step 1: the preview of `pr sync` when it would move issues. Declining leaves them as they are.
- Step 7: the full draft and the health, always asked because publishing is a status update. Declining publishes nothing.

## Output

The published update as plain text, ready to paste into Slack or email, and its path. Lead with the health and the progress numbers. Say when the period was the default window.

## If something is missing

- No epic ID and no epics: say there is none and offer `/pmkit:spec:import`.
- The epic has no issues: say so and ask whether to publish an update anyway.
- No previous update: cover the default window and say so.
- The git host is `none`: skip PR data and say so in one line.
- An error from the CLI: apply the rules for reading errors in the conventions.
