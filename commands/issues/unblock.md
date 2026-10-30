---
description: List what blocks a pull request from merging (checks, reviews, conflicts, open threads and policies) and the next step for each
argument-hint: "[id]"
disable-model-invocation: true
---

# Unblock a pull request

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, the command uses the current git branch (step 1) and has no issue.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Find the branch. When there is an `id`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` and take its `branch`. When the issue has no `branch`, stop and offer `/pmkit:issues:work <id>`. Without an `id`, run `git branch --show-current` and use that branch, with no issue. When there is no current branch, ask for the issue ID.
2. Read the blockers. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr blockers --branch <branch> --json`. Repeat each `note:` line of the CLI.
   1. When `pr` is `null`, say that the branch has no pull request. With an issue, offer `/pmkit:issues:work <id>` to open one. Without an issue, say to push the branch and open the pull request. Stop.
   2. When `state` is `MERGED` or `CLOSED`, say so. There is nothing to unblock. Stop.
3. Show the verdict. Lead with the pull request number, its link and `blocked` (`true`: blocked, `false`: nothing blocks the merge, `null`: nothing known blocks it, but part of it was not checked). Then show `blocking`, the items that stop the merge, and `pending`, the items that are open but that nothing requires. Never merge the two lists.
4. Show the five areas, the ones with items first, and `none` for an area with no items.
   - `checks`: each failing check (`checks.failing`) and each pending check (`checks.pending`). For a failing check, name `pmkit ci logs --branch <branch>` as the way to read the log of the failed run. A pending check needs waiting, or a look at the workflow if it never finishes.
   - `reviews`: the authors in `reviews.changesRequested`, who must re-review after the changes, and the reviewers in `reviews.requested`, who have not reviewed yet. When `reviews.decision` is `REVIEW_REQUIRED` and nobody is requested, say that a review is required and has not been requested.
   - `conflicts`: `conflicts.conflicting` means the branch must be rebased or merged with its base branch. `conflicts.behind` means the base branch moved. It blocks only when `blocking` lists it. Otherwise it is pending. When `conflicts.unknown` is `true`, GitHub has not computed the merge state yet. Say `not checked`, never `none`, and say to run the command again in a few seconds.
   - `threads`: each thread of `threads.open` and of `threads.outdated` with its file, line, author and link. An outdated thread is unresolved, and GitHub counts it when the protection requires conversation resolution. When `threads.incomplete` is `true`, say that only the first 100 threads were read.
   - `policies`: each line of `policies.unmet`. When `policies.unreadRule` is `true`, say that GitHub blocks the merge by a rule the command does not read, for example a ruleset, and that the user finds it in the repository settings or on the pull request page. Say that the base branch has no classic protection only when `policies.protected` is `false` and `policies.unreadRule` is `false`.
5. Show `draft`. When it is `true`, the pull request is a draft and cannot merge. This does not depend on the protection read, so show it even when `policies` is `null`. With an issue, offer to mark it ready: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr ready --issue <id> --dry-run --json`, show the pull request number and link, say it changes from draft to ready for review, and ask once with `AskUserQuestion`, following "How to show a write" in the conventions. When the user approves, run the same command without `--dry-run`. When the user declines, change nothing. Without an issue, say to mark it ready on GitHub, because `pr ready` needs an issue.
6. Say what was not checked. Each entry of `unchecked` names an `area` that the CLI could not read, with its `message`. Write `not checked` and the reason for that area, never `none`. A permission error (403 or 404) means the area is unknown and the user can read it in the repository settings. When an entry has a `nextStep`, show it. A network error or a server error makes the whole command fail, so show the error and offer to run it again.
7. Offer the next step. Name the first action that unblocks the pull request, in this order: draft, conflicts, requested changes, required checks and other policies, open threads, missing reviews.

Apart from the optional `pr ready` of step 5, the command reads only. It never reruns checks, resolves threads, requests reviews or merges.

## Confirmation points

- Step 5: marking a draft pull request ready for review, with the dry run first. `write_policy.confirm: none` skips this question.
- The rest of the command only reads.

## Output

The pull request number and link, the verdict, `blocking` and `pending`, the five areas with their items, the draft state, the areas not checked with the reason, and the first next step. Every issue shows its full ID.

## If something is missing

- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `pr blockers`. Say that the pull request state cannot be read, and that a GitHub host (`/pmkit:setup`) enables this command.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to retry after the fix.
- An area the token cannot read: it is in `unchecked`, as step 6 says. The rest of the result still holds.
- An error from the CLI: apply the rules for reading errors in the conventions.
