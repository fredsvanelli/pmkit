# link-repo fixes: repo/remote mismatch, cleared host, github without repo (PMK-188)

## Problem

`link-repo` (PMK-53) has five defects, found by the second review of PR #97:

1. `--remote my.remote --repo z/z` writes the default branch read from `my.remote`, a different repository from `z/z`.
2. `--git-host none` removes `git_host.repo` and keeps `default_branch`.
3. `--git-host github` with no remote and no `--repo` writes `system: github` without `repo`, and `validate` accepts it.
4. `argument-hint` in `commands/link-repo.md` omits `--default-branch`.
5. `readRemotes` runs `git` in `ctx.root` without checking that `ctx.root` is the repository root, so a pmkit root inside a bigger repository reads that repository's remotes.

## Decisions

These were taken by the implementer, not confirmed with the user.

1. The branch is inferred from the chosen remote only when the repo written equals the repo of that remote (`repoAfter === inferred.repo`). With `--repo` naming another repository, the branch stays as the file has it, and the existing "may be wrong" note fires when the repo changed.
2. `--git-host none` clears `default_branch` along with `repo`: the key is removed, `defaultBranch` is `{ before, after: null, source: 'flag' }`.
3. A result of `system: github` with no `repo` is refused by `link-repo` with `INVALID_INPUT`, "git_host github needs a repo", hint "Pass --repo owner/name, or --git-host none". It applies to the dry run and the write alike.
4. `validate` reports `git_host.repo is required when git_host.system is github`. As with the PMK-192 branch check, it is added in `validate.mjs`, outside `pmkitConfigMessages`, so it does not make writes refuse and `link-repo --repo` can repair such a file.
5. `readRemotes` runs `git rev-parse --show-toplevel` first. When the toplevel is not `ctx.root` (compared by realpath), it returns `{ ok: false, reason: '<root> is not the root of a git repository' }`, so the command infers nothing and says why, as it does outside a repository.
6. `argument-hint` lists `[--default-branch <name>]`.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria mapping

1. Decision 1. 2. Decision 2. 3. Decisions 3 and 4. 4. Decision 6. Decision 5 covers the fifth scope item.
