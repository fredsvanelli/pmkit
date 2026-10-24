---
description: Pause work on an issue. Leave a handoff note, push a draft PR when there is code, and change the status or the owner
argument-hint: "[id]"
disable-model-invocation: true
---

# Pause and hand off

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, find it from the current git branch (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Find the issue. When there is an `id`, use it. Otherwise run `git branch --show-current` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --category in_progress,in_review,todo --json`, and pick the issue whose `branch` equals the current branch. When none is found, ask for the ID. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` for its status, assignee and `branch`.
2. Write the handoff note: the current state, what is done, what is next and the open questions. Base it on `git log --oneline` and `git status --porcelain` of the branch. Show it and ask with `AskUserQuestion` whether to post it. The user can edit it first. When the user declines, stop and change nothing.
3. Ask with `AskUserQuestion` what happens to the issue: keep it in progress, move it back to `todo`, and whether to reassign it to someone (a member ID or `none`). Default to moving it to `todo` and keeping the assignee.
4. Preview the changes. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json` with the note in a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> todo --dry-run --json` when the user chose to move it, and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues assign <id> <member|none> --dry-run --json` when the user chose to reassign. When a `before` equals its `after`, say nothing would change for that call and leave it out.
5. Show the note and the `before` and `after` of the status and the assignee together. Ask once, following "How to show a write" in the conventions. When the user declines, stop and change nothing.
6. When the user approves, run the same commands without `--dry-run`.
7. Draft PR. `<base>` is `git_host.default_branch` in `.pmkit/config.yaml`, or `main` when that key is not set. When the branch has commits not on the base branch (`git log <base>..HEAD`) and the git host is GitHub, ask with `AskUserQuestion` whether to push it and open a draft PR. Uncommitted changes are not pushed, so list them and offer to commit first. When the user agrees, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr open --issue <id> --draft --dry-run --json`.
   - When `existing` is `false`, show `title`, `head`, `base` and `draft`, and ask once.
   - When `existing` is `true`, the branch already has an open PR, in `pr`. Show its number, link and whether it is a draft. Say that the real run only pushes the new commits to it, and that a PR already ready for review stays ready. Ask once whether to push.
   When the user approves, run the same command without `--dry-run`. When the user declines, skip the push and say the branch is not pushed.
8. Remove the temporary file.

## Confirmation points

- Step 2: the handoff note.
- Step 3 is a choice of input, not a confirmation.
- Step 5: the note, the status change and the owner change, together. `write_policy.confirm: none` skips this question.
- Step 7: pushing the branch and opening the draft PR, or pushing to the PR the branch already has. It always asks, because it publishes code.
- Recording the current branch on the issue, when `pr open` finds no branch: a single write that asks once.

## Output

The posted note, the PR link when the branch was pushed (say whether the PR is new or was already open), the issue status and the new owner.

## If something is missing

- No issue found: ask for the ID.
- No commits on the branch, or the git host is `none`: skip step 7 and say no draft PR was opened.
- `pr open` fails with `INVALID_INPUT` because the issue has no `branch`: say there is no branch recorded. When the user has commits to push on the current branch, offer to record it: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --branch <current branch> --dry-run --json`, show the `before` and `after` of `branch`, and ask once. When the user approves, run the same command without `--dry-run`, then retry step 7. When the user declines, skip the PR and say the branch is not pushed. Do not use `issues branch` here, because it creates a second branch.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. The note and status changes stay. Show the next step.
- An error from the CLI: apply the rules for reading errors in the conventions.
