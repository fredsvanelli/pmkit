# Review a pull request against its issue (PMK-61)

## Intent

The Dev catalog lists `review-pr-against-issue`: it compares the diff with the acceptance criteria and flags the gaps. Its degradation is "Reads the local diff". This issue adds the command and the one CLI read it needs, because the CLI has no way to read a diff.

## Goals

- `/pmkit:issues:review <id>` compares the diff of the issue branch with each acceptance criterion and reports, per criterion, whether the diff covers it, partly covers it or does not touch it.
- With no pull request it reads the local diff of the branch against the default branch.
- It offers to post the result as a comment on the issue and posts it only after confirmation.
- The CLI gets `pr diff [--branch b] [--base b] [--max-lines n]`, a read that returns the pull request diff or the local diff.

## Non-goals

- No change to the issue. The command does not tick criteria. `/pmkit:issues:progress` does that.
- No comment on the pull request itself, only on the issue.
- No new capability. `linked_code` already covers git host data, so only its `SERVED_BY` list grows.
- No style or bug review of the code. The command checks the issue's criteria.

## Decisions

- Command name: `/pmkit:issues:review`, file `commands/issues/review.md`. The catalog name is `review-pr-against-issue`, and the other commands drop the object they work on (`capture` for `create-issue-from-context`). My call.
- `pr diff` asks the host for the pull request of the branch (`getPullRequest({ head })`). When it finds an open or merged one, it runs `gh pr diff <number> --color never` and reports `source: "pull_request"`. When there is none, it runs the local diff described below and reports `source: "local"`. `<base>` is `--base`, else `git_host.default_branch`, else `main`.
- A diff can be huge. The CLI keeps the first `--max-lines` lines (default 2000) and reports `truncated` and `lines`, the full line count. The command says when the diff was cut and which criteria it could not check.
- `pr diff` needs a git host like every `pr` command. With `git_host.system: none` it answers `NOT_SUPPORTED`. The command file then runs `git diff <default>...<branch>` itself and says so.
- The issue comes from `issues get <id>`. Without a `branch` the command stops with a next step (`/pmkit:issues:work`), because there is nothing to diff.
- The report covers each criterion in the order of the issue, with the evidence (file and hunk) and one line per gap. It also lists changes in the diff that match no criterion, as "outside the criteria", without judging them.
- Posting uses `issues comment <id> --body-file - --dry-run --json`, then the real run after one confirmation, as `/pmkit:issues:summary` does.
- Linear: `pr diff` is a git host read, so the tracker manifest has nothing to declare. `issues comment` works on Linear.
- Only the two diff reads (`prDiff`, `localDiff`) have a timeout of 120 seconds. A push or a PR create can run a pre-push hook or git-lfs for longer. A timed out call is `UPSTREAM`. Diffs share the 256 MiB output cap of `MAX_OUTPUT`.
- A pull request counts only when it is open or merged. A closed one falls back to the local diff, with a `note:`. When `gh pr diff` fails with HTTP 406 (diff over the GitHub limit), the command also falls back to the local diff, with a `note:`.
- The local diff starts at `origin/<base>` when it exists and uses the local base only without a remote. It reads `origin/<branch>` when only origin has the branch. For the checked out branch it runs from the merge base to the working tree, so commits, index and tracked working tree changes are in. With a pull request, a `note:` says when local commits are not on origin.

## Acceptance criteria map

1. Compare with each criterion and flag gaps: steps 3 to 5 of the command file.
2. Local diff without a pull request: `pr diff` with `source: "local"`, tested with a real temp git repo.
3. Optional comment after confirmation: step 6 of the command file.
