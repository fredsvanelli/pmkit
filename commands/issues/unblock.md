---
description: List what blocks a pull request from merging (checks, reviews, conflicts, open threads and policies) and the next step for each
argument-hint: "[id]"
disable-model-invocation: true
---

# Unblock a pull request

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, the command uses the current git branch (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Find the branch. When there is an `id`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` and take its `branch`. When the issue has no `branch`, stop and offer `/pmkit:issues:work <id>`. Without an `id`, run `git branch --show-current` and use that branch. When there is no current branch, ask for the issue ID.
2. Read the blockers. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr blockers --branch <branch> --json`. Repeat each `note:` line of the CLI.
   1. When `pr` is `null`, say that the branch has no pull request and offer `/pmkit:issues:work <id>` to open one. Stop.
   2. When `state` is `MERGED` or `CLOSED`, say so. There is nothing to unblock. Stop.
3. Show the result. Lead with the pull request number, its link and one line: `blocked` or `nothing blocks the merge`. Then list the five areas below, the ones with items first. Write `none` for an area with no items.
   - `checks`: each failing check (`checks.failing`) and each pending check (`checks.pending`). For a failing check, name `pmkit ci logs --branch <branch>` as the way to read the log of the failed run. A pending check needs waiting, or a look at the workflow if it never finishes.
   - `reviews`: the authors in `reviews.changesRequested`, who must re-review after the changes, and the reviewers in `reviews.requested`, who have not reviewed yet. When `reviews.decision` is `REVIEW_REQUIRED` and nobody is requested, say that a review is required and has not been requested.
   - `conflicts`: `conflicts.conflicting` means the branch must be rebased or merged with its base branch. `conflicts.behind` means the base branch moved and the branch must be updated.
   - `threads`: each open thread of `threads.open` with its file, line, author and link. When `threads.incomplete` is `true`, say that only the first 100 threads were read.
   - `policies`: each line of `policies.unmet`, and a draft pull request (`policies.draft`), which `pmkit pr ready --issue <id>` marks ready for review after the user confirms it. When `policies.protected` is `false`, say that the base branch has no protection rules.
4. Say what was not checked. Each entry of `unchecked` names an `area` that the CLI could not read, with its `message`. Write `not checked` and the reason for that area, never `none`. A permission error on branch protection means the policies are unknown, so say that the user can read them in the repository settings.
5. Offer the next step. Name the first action that unblocks the pull request, in this order: conflicts, failing checks, changes requested, open threads, missing reviews, unmet policies.

The command reads only. It never reruns checks, resolves threads, requests reviews or merges.

## Confirmation points

None. The command only reads.

## Output

The pull request number and link, the verdict, the five areas with their items, the areas not checked with the reason, and the first next step. Every issue shows its full ID.

## If something is missing

- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `pr blockers`. Say that the pull request state cannot be read, and that a GitHub host (`/pmkit:setup`) enables this command.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to retry after the fix.
- An area the token cannot read: it is in `unchecked`, as step 4 says. The rest of the result still holds.
- An error from the CLI: apply the rules for reading errors in the conventions.
