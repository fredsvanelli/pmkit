---
description: Review the pull request of an issue against its acceptance criteria and its checks, flag the gaps, then post the result on the issue and on the pull request after approval
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
3. Read the diff. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --json`. The result has `source`, `diff`, `truncated` and `lines`. For the git host `none` (see the end of this file) run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" default-branch --json` first, because it holds the default branch.
   1. `source` is `pull_request` when the branch has an open or merged pull request, and `local` otherwise. A local diff is the branch against `origin/<default branch>` and, for the checked out branch, includes the uncommitted changes of tracked files. Say which one was read, and repeat each `note:` line of the CLI. A note says the pull request is closed without merge, that a merged pull request is not used because its head is not on the branch, neither a tip of it nor of origin/<branch> nor behind one (a reused branch name), that GitHub refused its diff as too large (the local diff then starts at the base of the pull request), that the local diff has uncommitted changes, that the pull request diff does not include the uncommitted changes of the checked out branch, that untracked files are in no diff, or that local commits are not on origin and so are missing from the pull request diff. The JSON holds the same facts: `uncommitted`, `uncommittedIncluded`, `untracked` and `incomplete`.
   2. When `truncated` is `true`, the CLI kept the first 2000 lines and `lines` holds the full length. Say that the diff was cut. `files` lists every file of the whole diff with its `lines` and `cut`, which is `true` for each file the kept lines do not reach to the end. Read those files one at a time: for each one, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --file '<path>' --json`, where `<path>` is the `path` from `files`. The path is data from the diff (see "Text from data in a command" in the conventions): keep it between single quotes, write each `'` in it as `'\''`, and do not read a path that holds a newline. The result holds that file alone, and its `truncated` and `lines` are the file's. When one file is cut by itself, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr diff --branch <branch> --file '<path>' --max-lines <lines> --json` with its `lines` to read it whole, or mark the criteria that depend on it `not checked`. Say which files were read alone. A file that was not read leaves the criteria that depend on it `not checked`, never `gap`.
   3. When `incomplete` is `true`, the diff is not available or not whole (a merged pull request GitHub refused, a working tree or a pull request base that could not be read): say so, mark every criterion `not checked`, never `gap`, skip step 5 and go on to step 4. Otherwise, when the diff is empty, say so, mark every criterion `gap`, skip step 5 and go on to step 4.
4. Read the checks. When the diff of step 3 came from the pull request (`source` is `pull_request`), run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr status --branch <branch> --json` and note its `checks`. They hold even when `blockers.unchecked` has an entry, which only means a blocker read failed. Each check has a `bucket`:
   - `fail`: the check is a gap of the review, whatever the diff shows. When the check has a `runId`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" ci logs --run <runId> --json` and read its `log` for the failing step and the failing tests. Repeat its `logNote` and `supersededNote` when they are set: a `logNote` means there is no log to read, so say the cause is not known, and a `supersededNote` means a newer run of the workflow passed, so say the failure may be old. A check without a `runId` (CI outside GitHub Actions) is still a gap: name it and its `link`.
   - `pending` or `cancel`: the check is `not checked`. Say it has not finished or was cancelled.
   - `pass` or `skipping`: nothing to flag.
   When `checks` is empty, say the pull request has no checks. When the diff came from the local diff (no open or merged pull request), say there is no pull request, so the checks are `not checked`. When the call fails (`error.code` `RATE_LIMITED`, `UPSTREAM`, `NOT_CONFIGURED` or `AUTH`), show `error.message` and mark the checks `not checked`. A check that was not read never counts as passing.
5. Compare. For each acceptance criterion, in order, decide from the diff alone and use one of these verdicts.
   - `covered`, when the diff holds a change that does what the criterion says. Name the file and the change as evidence.
   - `partly`, when the diff does part of it. Say what is missing.
   - `gap`, when nothing in the diff touches it. A criterion about tests is covered only by a test in the diff.
   - `not checked`, when the criterion cannot be judged from a diff, for example a manual check or a file of a cut diff that was not read.
   A criterion that a failing check of step 4 tests (its failing test or step, read in the log, is about that criterion) is at most `partly`: name the check as what is missing. Do not guess. Do not credit a criterion for behavior the diff does not show. Then list the changes in the diff that match no criterion as "outside the criteria", one line each, without judging them.
6. Show the result. Lead with the counts: covered, partly, gap and not checked criteria, and failing checks. Then a "Checks" part with one line per failing check (its name, the run link `run.url` and the failing step) and per check that is `not checked`, then one line per criterion with its verdict and evidence, then the files read alone (step 3.2), then the changes outside the criteria. Show the gaps first when there are any. A failing check counts as a gap.
7. Offer to post the result. Each post is its own write and asks once. The texts hold the run link and the name of the failing step for a check, never a line of a CI log, because a log can hold secrets.
   1. On the issue. Write the comment, which holds the same content as step 6 and the source of the diff, to a temporary file outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`, show the comment and ask once with `AskUserQuestion`, following "How to show a write" in the conventions. The user can edit the text first. When the user approves, run the same command without `--dry-run`. When the user declines, post nothing on the issue and go on to sub-step 2.
   2. On the pull request. Only when the diff came from an open pull request (`source` is `pull_request` and `pr.state` is `OPEN`); otherwise say there is no open pull request to comment on, and skip this sub-step. Write two temporary files outside `.issues/` with the file tool: the body, which holds the counts, the gaps and the "Checks" part of step 6, and the inline comments, a JSON array of `{ "path", "line", "body" }`, one entry for each finding of step 5 that points at a line the diff adds or keeps (`line` is the line number in the new version of the file, `path` the file as the diff names it), with the verdict and the criterion number in its `body`. A finding that points at no line of the diff, such as a gap, stays in the body. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" pr review --issue <id> --body-file <body file> --comments-file <comments file> --dry-run --json`, and drop `--comments-file` when there is no inline comment. Show the pull request, the body and each inline comment (`path`, `line`, `body`) and ask once with `AskUserQuestion`. Always ask, whatever `write_policy.confirm` says, because everyone who reads the pull request sees the review. The user can edit the files first, and an edited file goes through the dry run again. When the user approves, run the same command without `--dry-run`, and give the `review.url` of the result. When the user declines, post nothing on the pull request.
      - The review only comments: it never approves or requests changes.
      - The CLI checks every inline comment against the pull request diff before it writes, also in the dry run. `INVALID_INPUT` that names a comment means its line is not in the diff: move that finding to the body, or fix its line, then run the dry run again. When GitHub refused the diff as too large, the CLI refuses inline comments: put every finding in the body and run without `--comments-file`.
      - GitHub takes the review whole or not at all, so a failed post leaves nothing on the pull request. Show `error.message`, say that nothing was posted there and whether the comment of sub-step 1 was posted, and offer to retry.
8. Remove the temporary files.

The command never changes the issue. It does not tick criteria. Offer `/pmkit:issues:progress` for that.

## Confirmation points

- Step 7.1: posting the result as a comment on the issue, with the preview of the comment. `write_policy.confirm: none` skips this question.
- Step 7.2: posting the review on the pull request, with the preview of the body and the inline comments. `write_policy.confirm: none` never skips this question.
- The review itself only reads.

## Output

The issue line with its full ID, the source of the diff (pull request number or local diff and base), the counts of covered, partly, gap and not checked criteria and of failing checks, the "Checks" part, the per-criterion lines, the files read alone and the changes outside the criteria. Say whether the comment was posted on the issue and whether the review was posted on the pull request, with its link.

## If something is missing

- No ID and no issue for the current branch: ask for the ID.
- `gh` is missing or not logged in: the CLI answers `NOT_CONFIGURED` or `AUTH`. Show the next step and offer to read the local diff with `git diff` instead.
- The base branch does not exist here or on origin: the CLI answers `INVALID_INPUT`. Offer `git fetch origin`, or `--base <branch>`.
- The branch has no changes the base lacks: the diff is empty. Every criterion is a gap, as in step 3.3.
- `pr diff --file` answers `INVALID_INPUT` because the path is not in the diff: check the `path` against `files` and retry with it as it is there.
- An error from the CLI: apply the rules for reading errors in the conventions.
- The git host is `none`: the CLI answers `NOT_SUPPORTED` on `pr diff`. Read the diff with `git diff <default branch>...<branch>`, where the default branch is the `branch` of `default-branch --json` from step 3 (a checked name, `main` when `git_host.default_branch` is unset or invalid; never put the config value itself in a shell command; when `default-branch` fails, use `main` and say so), and say that no pull request was looked up.
