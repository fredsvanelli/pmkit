---
description: Review the pull request of an issue against its acceptance criteria and flag the gaps, then post the result as a comment after approval
argument-hint: "[id]"
disable-model-invocation: true
---

# Review a pull request against its issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID. When it is empty, find it from the current git branch (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Find the issue. When there is an `id`, use it. Otherwise run `git branch --show-current` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --category in_progress,in_review --json`, then pick the issue whose `branch` equals the current branch. When none matches, ask for the ID.
2. Read the issue. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json`. Note the acceptance criteria (numbered from 1, in order), the description and the `branch`. When the issue has no `branch`, stop and say there is nothing to compare. Offer `/pmkit:issues:work <id>`. When it has no acceptance criteria, stop and offer `/pmkit:issues:update <id>` to add them.
3. Read the diff. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --json`. The result has `source`, `diff`, `truncated` and `lines`.
   1. `source` is `pull_request` when the branch has a pull request, and `local` when it has none. In the second case the diff is the branch against `git_host.default_branch`. Say which one was read, using the `note:` line of the CLI when there is one.
   2. When `truncated` is `true`, the CLI kept the first 2000 lines and `lines` holds the full length. Say that the diff was cut. When the files left out could matter, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --max-lines <lines> --json` to read it whole, or mark the criteria that depend on the cut part as "not checked".
   3. When the diff is empty, say so and stop. Every criterion is a gap.
4. Compare. For each acceptance criterion, in order, decide from the diff alone and use one of these verdicts.
   - `covered`, when the diff holds a change that does what the criterion says. Name the file and the change as evidence.
   - `partly`, when the diff does part of it. Say what is missing.
   - `gap`, when nothing in the diff touches it. A criterion about tests is covered only by a test in the diff.
   - `not checked`, when the criterion cannot be judged from a diff, for example a manual check or a cut diff.
   Do not guess. Do not credit a criterion for behavior the diff does not show. Then list the changes in the diff that match no criterion as "outside the criteria", one line each, without judging them.
5. Show the result. Lead with the counts, then one line per criterion with its verdict and evidence, then the changes outside the criteria. Show the gaps first when there are any.
6. Offer to post the result as a comment on the issue. Write the comment, which holds the same content as step 5 and the source of the diff, to a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`, show the comment and ask once with `AskUserQuestion`, following "How to show a write" in the conventions. The user can edit the text first. When the user approves, run the same command without `--dry-run`. When the user declines, post nothing.
7. Remove the temporary file.

The command never changes the issue. It does not tick criteria. Offer `/pmkit:issues:progress` for that.

## Confirmation points

- Step 6: posting the result as a comment, with the preview of the comment. `write_policy.confirm: none` skips this question.
- The review itself only reads.

## Output

The issue line with its full ID, the source of the diff (pull request number or local diff and base), the counts of covered, partly, gap and not checked criteria, the per-criterion lines and the changes outside the criteria. Say whether the comment was posted.

## If something is missing

- No ID and no issue for the current branch: ask for the ID.
- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `pr diff`. Read the diff with `git diff <default branch>...<branch>`, where the default branch is `git_host.default_branch` or `main`, and say that no pull request was looked up.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to read the local diff with `git diff` instead.
- The base branch does not exist here or on origin: the CLI answers `INVALID_INPUT`. Offer `git fetch origin`, or `--base <branch>`.
- The branch has no commits the base lacks: the diff is empty. Say so, as in step 3.
- An error from the CLI: apply the rules for reading errors in the conventions.
