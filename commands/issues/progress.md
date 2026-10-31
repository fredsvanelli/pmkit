---
description: Post what you did on an issue as a comment, tick acceptance criteria and log the time spent
argument-hint: "[id]"
disable-model-invocation: true
---

# Update progress

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, find it from the current git branch (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Find the issue. When there is an `id`, use it. Otherwise run `git branch --show-current` and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --category in_progress,in_review --json`, then pick the issue whose `branch` equals the current branch. When none matches, ask for the ID.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` for the title, the acceptance criteria and the `branch`.
3. Summarize the session. Run `git log --oneline <base>..HEAD` and `git diff --stat <base>..HEAD`, where `<base>` is `git_host.default_branch` in `.pmkit/config.yaml`, or `main` when that key is not set. Write a short comment: what was done, what is left and any open question.
4. Show the comment text and ask with `AskUserQuestion` whether to post it. The user can edit it first. When the user declines, skip the post and go on to step 7.
5. Write the text to a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`. Post it when the user approved in step 4: run the same command without `--dry-run`.
6. Remove the temporary file.
7. Criteria. Compare the acceptance criteria from step 2 with the work. For each criterion that looks done and is not checked, list it by number (1-based). Ask with `AskUserQuestion` which to tick. For each approved criterion, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --check <n> --dry-run --json`, show `before` and `after`, and run it without `--dry-run` after the approval. Several criteria are several records, so show them together as one preview and ask once. When the user declines, tick nothing.
8. Time. Ask with `AskUserQuestion` whether to log time, and how much. Skip the question when the user said no time. When the user gives a time, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues log-time <id> <time> --dry-run --json`, show it, ask once, and run it without `--dry-run` after the approval. The time is minutes (`90`, `45m`) or hours (`1h30`, `1.5h`), and the CLI reads it. `/pmkit:issues:log-time` describes the whole flow: the issue total after the write and the comment that replaces the entry when the `time_tracking` capability is `absent`. Follow it for those two cases.

## Confirmation points

- Step 4: the comment text, before it is posted. `write_policy.confirm: none` skips this question.
- Step 7: which criteria to tick, as one preview. The same setting skips the question, but the choice of criteria in the question is an input and stays.
- Step 8: the time entry, before it is written, as in `/pmkit:issues:log-time`. The same setting skips this question.

## Output

The posted comment, the criteria now ticked and the minutes logged. Say which of these were skipped.

## If something is missing

- No issue found from the branch and no ID: ask for the ID.
- No commits ahead of the base branch: write the comment from what the user says, and say so.
- An error from the CLI: apply the rules for reading errors in the conventions.
