---
description: Digest of what changed since the last business day, per person, with what needs attention
argument-hint: "[person] [since <date>]"
disable-model-invocation: true
---

# Standup digest

Arguments: `$ARGUMENTS`

## Parameters

- `person` (optional): a member ID, or `me`. Without it, the digest covers everyone.
- `since <date>` (optional): the start of the period, as `YYYY-MM-DD`. Without it, the period starts on the last business day. That is yesterday, or Friday when today is Monday.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Sync merged pull requests. This is a bulk write, so preview it first. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr sync --dry-run --json`. When `moved` is empty, skip to step 2. Otherwise show each issue in `moved` with its PR and the change from `in_review` to `done`, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing and carry on. Show each entry of `problems` as a warning. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, say in one line that PR data is unavailable and why, and continue without it. When it fails with `INVALID_INPUT` and `error.message` starts with `.pmkit/config.yaml is not valid`, say in one line that `.pmkit/config.yaml` is not valid, so the sync is skipped, and go on with step 2.
2. Compute the start of the period. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" events --since <start> --json`. Group the events by `by`. For each person, list the issues they moved, created and completed, and the comments they wrote.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category in_progress,in_review,todo --json`. Read `defaults.stuck_business_days` from `.issues/config.yaml` (3 when missing) and compute the cutoff date, that many business days before today. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" events --since <cutoff> --json`, because the period of step 2 can be shorter than the stuck window. An issue is stuck when it is in `in_progress` or `in_review` and no event since the cutoff names it. An issue is blocked when a `blockedBy` issue is not `done` or `canceled`.
4. For each in-progress or in-review issue with a `branch`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr status --branch <branch> --json`. Note whether the PR is open, merged or waiting for review, and its checks. When the call fails with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`, stop calling `pr status`, and say in one line that PR data is unavailable and why.
5. When `person` is given, keep only that person's rows. When `person` is `me`, first run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" whoami --json` and use its `id`, because events and assignees hold member IDs. When the tracker has one member, use the personal format of the Output section.

## Confirmation points

- Step 1: the preview of `pr sync` when it would move issues. Declining leaves them as they are.
- The rest of the command only reads.

## Output

For several members, one short block per person with what moved, what was created, what was completed, new comments and the PRs opened, merged or waiting for review. Then a "needs attention" list with the stuck and blocked issues and PRs with failing checks, each with its full ID and the reason. For a solo tracker, three lines: yesterday, today (the issues in `in_progress`) and blockers. Write it so the user can paste it into a channel, and give the period it covers.

## If something is missing

- No events in the period: say so, and show the in-progress issues instead.
- The git host is `none`: skip PR data and say so in one line.
- A `person` that is not a member: show the member IDs and ask again.
- An error from the CLI: apply the rules for reading errors in the conventions.
