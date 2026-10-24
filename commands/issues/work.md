---
description: Pick up an issue. Claim it, create its branch, plan and implement, open the PR and move it to review
argument-hint: "[id]"
disable-model-invocation: true
---

# Work on an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (optional): the issue ID, for example `ISS-7K3Q`. When it is empty, the command picks the top issue of the user's assigned work (step 1).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. When there is no `id`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --assignee me --category in_progress,todo --json`. Sort the result yourself: `in_progress` first, then priority, then due date, then issues with no open blocker first. Propose the top issue and ask with `AskUserQuestion` whether to use it. When the user declines or the list is empty, stop and say so.
2. Read the context. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json`. Note the acceptance criteria, the comments, the parent, the `children`, the `blockedBy` issues, the linked docs and the `branch` field. When the issue has a parent, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <parent> --json` for it. When the parent ID starts with the epic prefix (`EPC-` by default), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <parent> --json` instead.
3. Check readiness. List every problem found: the issue is blocked by an issue not in `done` or `canceled`, it is assigned to someone else, it is already `done` or `canceled`, or it has no acceptance criteria. When there is a problem, ask with `AskUserQuestion` whether to continue. When the user declines, stop and change nothing.
4. Check the working tree. Run `git status --porcelain`. When there are uncommitted changes, ask with `AskUserQuestion` whether to continue, because creating the branch switches the working tree. When the user declines, stop and change nothing.
5. Claim the issue. Skip this step when the issue is already assigned to the user and in `in_progress`.
   1. When it is not assigned to the user, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues assign <id> me --dry-run --json`.
   2. When it is not in `in_progress`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> in_progress --dry-run --json`.
   3. Show the `before` and `after` of both changes together and ask once, following "How to show a write" in the conventions. When the user declines, stop and change nothing.
   4. When the user approves, run the same commands without `--dry-run`.
6. Create the branch. When the issue already has a `branch`, run `git switch <branch>` and skip the rest of this step. Otherwise check `git branch --show-current` and `git log <default branch>..HEAD --oneline`. When the current branch is not the default branch and has commits the default branch lacks, ask with `AskUserQuestion` whether to start the new branch from the current branch, and add `--from <current branch>` to the calls below when the user says yes. Without that flag the branch starts from the default branch and those commits stay behind. Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues branch <id> --dry-run --json`, show the branch name and the base (`from`), and ask once. When the user declines, stop. The claim of step 5 stays, so say so. When the user approves, run the same command without `--dry-run`. The command creates the branch, switches to it and records it in the issue.
7. Propose a plan. Read the code the issue touches and write an implementation plan that covers each acceptance criterion. Show it and ask with `AskUserQuestion` whether to go ahead and whether to post it as a comment on the issue. When the user declines the plan, stop and say where the work stands. To post it, write the text to a temporary file outside `.issues/`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`, show the comment and ask once, then run the same command without `--dry-run`.
8. Implement the plan with the normal flow of the session. Put the issue ID in every commit message, for example `feat: add export (ISS-7K3Q)`.
9. Deliver. Ask with `AskUserQuestion` whether to open the PR. When the user declines, stop. The code stays committed on the branch, so say so.
   1. Write the PR body to a temporary file outside `.issues/`: a short summary of the change, the issue ID and a link to the issue.
   2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr open --issue <id> --body-file <file> --dry-run --json`. When `existing` is `false`, show `title`, `head`, `base` and the body, and ask once. When `existing` is `true`, the branch already has an open PR, in `pr`, for example a draft that `/pmkit:issues:pause` opened. Show its number, link and whether it is a draft, say that the real run only pushes the new commits to it and does not use the body, and ask once whether to push.
   3. When the user approves, run the same command without `--dry-run`. This pushes the branch, and opens the PR when `existing` was `false`. When the user declines, stop. The code stays committed on the branch, so say so.
   4. When the PR is a draft (`isDraft` is `true` in the result of sub-step 3), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr ready --issue <id> --dry-run --json`. Show the PR number and link, say it changes from draft to ready for review, and ask once with `AskUserQuestion`. When the user approves, run the same command without `--dry-run`. When the user declines, leave the PR as a draft, say so, and go on.
   5. Write a summary of what was done and the PR link to a temporary file. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`, show it and ask once. When the user approves, run it without `--dry-run`.
   6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> in_review --dry-run --json`, show `before` and `after` and ask once. When the user approves, run it without `--dry-run`.
10. Offer follow-ups. When the work found extra scope or tech debt, list the candidates and ask which to create. For each one chosen, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --dry-run --json`, show the new record and ask once. After approval, run it without `--dry-run`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <id> --kind related --dry-run --json`, show it and ask once, and run it without `--dry-run`.
11. Remove the temporary files.

The command never moves the issue to `done`. After the PR merges, `/pmkit:issues:mine` runs `pr sync`, which does it.

## Confirmation points

- Step 1: the issue chosen from the list, when no ID was given.
- Step 3: continue despite a readiness problem.
- Step 4: continue with uncommitted changes.
- Step 5: the assignment and the move to `in_progress`, together.
- Step 6: the branch name and base, and whether to start from the current branch when it holds commits.
- Step 7: the plan, and whether to post it. Posting asks once more, as a write.
- Step 9: opening the PR (or pushing to the PR the branch already has), marking a draft PR ready for review, then the summary comment, then the move to `in_review`. Each write asks once.
- Step 10: which follow-ups to create, then each create and each link.

`write_policy.confirm: none` skips the single-write questions of steps 5 to 10. It never skips the readiness questions of steps 3 and 4, or the questions about the plan, opening or pushing the PR, and marking it ready.

## Output

The PR link, the issue line with its full ID and new status, the branch name and the follow-up issues created, if any. End with `/pmkit:issues:progress` as the way to log time and `/pmkit:issues:mine` to pick the next issue.

## If something is missing

- No issue and an empty list: say there is nothing assigned to the user, and offer `/pmkit:issues:find`.
- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `issues branch` and `pr open`. Claim the issue, do the work on a branch of the user's choice, and say that the PR and the branch record need a GitHub host (`/pmkit:setup`).
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step, leave the branch as it is, and offer to retry after the fix.
- The issue has no `branch` when `pr open` fails with `INVALID_INPUT`: run step 6 first.
- `pr ready` fails with `INVALID_INPUT` because the PR is no longer open or is already ready: show `error.message`, skip sub-step 4 of step 9 and go on.
- An error from the CLI: apply the rules for reading errors in the conventions.
