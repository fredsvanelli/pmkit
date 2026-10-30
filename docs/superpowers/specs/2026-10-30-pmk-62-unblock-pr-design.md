# Unblock a pull request (PMK-62)

## Intent

The Dev catalog lists `unblock-pr`: "Pending checks, reviews, conflicts, threads and policies". A pull request that cannot merge shows its causes in five places on GitHub. This issue adds one read that gathers them and a command that tells the user what to do for each.

## Goals

- `pr blockers [--branch b]` reads the pull request of a branch and returns what blocks its merge: failing and pending checks, requested changes and missing reviews, merge conflicts, open review threads, and branch protection rules that are not met.
- `/pmkit:issues:unblock [id]` runs it for the branch of an issue (or the current branch) and lists each blocker with the next action.
- A read that GitHub refuses, such as branch protection without admin rights, is reported as "not checked" with its reason. The rest of the result still comes back.

## Non-goals

- No write. The command does not rerun checks, resolve threads, request reviews or merge.
- No Linear specific work. `pr blockers` is a git host read.
- No repository rulesets (`rules/branches`). Only classic branch protection. Candidate follow-up.

## Decisions

- Names: CLI `pr blockers`, command file `commands/issues/unblock.md`. The catalog name is `unblock-pr`, and the neighbours drop the object (`review`). My call.
- Reuse. Checks come from `prChecks`, reviews from `prReviews`, and failing runs are reached through `ci logs`. New host methods: `prMergeState(number)` (`gh pr view --json mergeable,mergeStateStatus,reviewDecision,baseRefName`), `prThreads(number)` (one `gh api graphql` query for `reviewThreads`, first 100) and `branchProtection(base)` (`gh api repos/{owner}/{repo}/branches/<base>/protection`).
- The classification lives in `scripts/lib/pr-blockers.mjs`. `collectBlockers(host, pr)` calls the host reads. A read that fails with `UPSTREAM` lands in `unchecked: [{ area, code, message }]` and its section is `null`. `NOT_CONFIGURED`, `AUTH` and `RATE_LIMITED` still fail the command, since nothing could be read.
- A branch without protection (404 "Branch not protected") is a successful read with `policies.protected: false`.
- Blockers by area:
  - `checks`: `failing` (bucket `fail` or `cancel`) and `pending`.
  - `reviews`: the latest review of each author that is `CHANGES_REQUESTED`, the requested reviewers who have not reviewed, and `reviewDecision`.
  - `conflicts`: `mergeable` is `CONFLICTING`, or `mergeStateStatus` is `DIRTY` (conflict) or `BEHIND` (base moved).
  - `threads`: unresolved, not outdated threads, each with path, line, author, first comment and URL. `incomplete` is true past 100 threads.
  - `policies`: required approvals not reached, required status checks that do not pass, conversation resolution required while threads are open, and `draft` for a draft pull request.
- `blocked` is true when any area has an item. A merged or closed pull request returns `blocked: false` with its `state` and skips the other reads.
- No pull request for the branch: `pr: null`, `blocked: false`, text "no pull request for <branch>", as `pr status` does.
- `git_host: none`: `pr blockers` answers `NOT_SUPPORTED` from `ctx.host()`. The command file says the pull request state cannot be read and points to `/pmkit:setup`.
- Only reads, so no timeouts. The graphql call uses the shared `MAX_OUTPUT`.
- The command file finds the issue branch as `issues:review` does and gives a next step per blocker kind (`ci logs`, `/pmkit:issues:progress`, a rebase).

## Acceptance criteria map

1. Lists the pending checks, reviews, conflicts, open threads and policies: the fields `checks`, `reviews`, `conflicts`, `threads` and `policies` of `pr blockers`, rendered by the command file.
