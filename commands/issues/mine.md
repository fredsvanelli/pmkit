---
description: List the issues assigned to you, with the state of their pull requests and the next one to pick up
argument-hint: ""
disable-model-invocation: true
---

# My issues

Arguments: `$ARGUMENTS`

## Parameters

None.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on with step 2. Show each entry of `problems` as a warning. When the call fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" cycle current --json`. When there is an active sprint, note its ID.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --sprint current --json`. When there is no active sprint, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --json` and say in one line that no sprint is active, so the list shows all assigned issues.
4. Drop the issues in `done` or `canceled`. Keep the rest in creation order, oldest first, as the CLI returns them. An issue is blocked when `blockedBy` holds an issue not in `done` or `canceled`.
5. For each issue with a `branch`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr status --branch <branch> --json`. Note the PR, its checks and its reviews. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, stop calling `pr status`, and say in one line that PR data is unavailable and why (use `error.message`).
6. Pick one recommended next issue: the oldest created issue that is not blocked. Give the reason in one sentence.

## Confirmation points

- Step 1: the merged PRs to move to `done`, always asked because it is a bulk change. Declining skips the sync and the list still shows.
- The rest is read-only.

## Output

An issue table in creation order, oldest first, as the CLI returns it, with these columns after the standard five: priority, due date, blocked (yes or no) and PR (number and state, or empty). Then the open PRs awaiting review, from step 5, each with its review state. End with the recommended issue and its reason, and the command to start it, `/pmkit:issues:work <id>`.

## If something is missing

- Nothing assigned to the user: say so and offer `/pmkit:issues:find`.
- The git host is `none` or `gh` is unavailable: skip steps 1 and 5, show the list without the PR column, and say PR data is unavailable and why.
- An error from the CLI: apply the rules for reading errors in the conventions.
