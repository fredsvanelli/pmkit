# pr ready says when the branch is behind origin (PMK-308)

Short design (small change, approved autonomously under the orchestrator brief).

## Intent
A draft opened earlier has often fallen behind `origin/<base>` when it is marked ready, which is when reviewers start to read it. `pr ready` says so, as `pr open` does since PMK-305.

## Goals
- `pr ready`, real and dry run, adds `behindNotes(ctx, branch, base, true)` to `notes` (stderr text and the JSON `notes`).
- Next step always ends with `git push --force-with-lease origin <branch>`: the PR is open, so the branch is on origin (`pushed` is true on both runs).
- No note when level or without `origin/<base>`; `could not compare` when git cannot count.

## Non-goals
Fetching, rebasing, refusing. No second note helper.

## Branch and base
- Branch: `issue.branch`, as before.
- Base: the PR's own `baseRefName`, not the default branch. `getPullRequest({ head }, { detail: true })` returns it in the same single `gh pr view` call (`pr.detail.baseRefName`). When it is missing, fall back to `defaultBranch(ctx)`.
- The `detail` read removes the detail fields from the returned data, so the JSON of `pr ready` is unchanged apart from `notes`.

## Approaches
1. Base = default branch (as `pr open`): no gh change, but wrong for a PR that targets another branch.
2. Base = PR's `baseRefName` via the detail read (chosen): correct, one call, falls back to the default.

## Tests (scripts/cli-pr.test.mjs, origin bare local, fake gh)
Behind (count, next step, dry and real), level, no origin/<base>, could not compare, PR with another base, following the next step makes the push pass.
