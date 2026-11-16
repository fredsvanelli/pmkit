# PMK-290: `issues branch` when the default branch is only on the remote

Brainstorming was done without questions (worker run); the calls below are mine.

## Problem
`issues branch` runs `git switch -c <branch> <from>` with `from` the default branch. In a clone or worktree with no local `develop`, git fails with `fatal: invalid reference: develop`.

## Design
- Without `--from`: if `refs/heads/<default>` exists, use `<default>` (unchanged). Else, if `refs/remotes/origin/<default>` exists, use `origin/<default>`. Else fail.
- `origin` is the remote `pr open` pushes to (`git push -u origin`), so it is the one used here. No fetch (out of scope).
- With `--from`: it must resolve to a commit, or the command fails.
- Failure is `INVALID_INPUT` with a next step (`Pass --from <existing branch>`, plus `git fetch origin` when the remote branch is missing). The check runs in `--dry-run` too, before any write.
- Output: `from` in the JSON is the ref used (`origin/develop`). The text says `created branch X from origin/develop (no local develop)`, and the dry-run text says the same.

## Non-goals
Fetching, choosing another remote, changes to `host.mjs`.
