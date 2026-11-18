# PMK-333: npm test failures on WSL and case-sensitive file systems

## Problem

`npm test` fails on a clean `develop` checkout under WSL. Each failure comes from a test that depends on the machine, not from the code under test.

| Test | Root cause |
| --- | --- |
| `cli-pr` "pr diff local fallback of a stacked pull request uses the PR base, and --base wins" | The test runs `git rebase` without a committer identity. The tests set `GIT_CONFIG_GLOBAL` to the null device, so git falls back to the passwd entry. On this machine the passwd name field is empty, git refuses the empty name, and the rebase stops with a detached HEAD. |
| `cli-pr` "pr open counts only what the branch lacks" | The same cause: `git merge --no-edit` makes a merge commit without a committer identity, so the merge fails and the branch stays behind. |
| `validate-views` "two view files whose names differ only in case" | The test reads `problems[0]`. The `team` fixture has a file with conflict markers whose problem sorts first, so the test reads the wrong problem. |
| `github-host` "the default exec throws ENOENT" | `spawnSync` searches `PATH`. When a folder in `PATH` has no search permission, as some Windows folders under `/mnt/c` do, Linux reports `EACCES` instead of `ENOENT` for a command it cannot find. The test passes or fails with the user's `PATH`. |

Every other commit in `cli-pr.test.mjs` already passes `-c user.name=t -c user.email=t@x.dev`.

## Decision

Fix the tests. The code stays as it is.

1. The `git rebase` and `git merge` calls in `cli-pr.test.mjs` pass the same `-c user.name=t -c user.email=t@x.dev` as the other commits.
2. The `validate-views` case test finds its problem by path (`.issues/views/mine.yaml`), as the neighbouring tests do.
3. The `github-host` ENOENT test runs `defaultExec` with `env.PATH` set to an empty temporary folder, so the result no longer depends on the user's `PATH`.

The user chose to leave the code alone for `EACCES` (option A). `EACCES` from `spawnSync` can also mean the command exists and is not executable, so reporting it as "gh is not installed" would be wrong, and it would change user-facing errors in four places. Mapping `EACCES` becomes a follow-up candidate.

## Out of scope

- The `EACCES` mapping in `github/host.mjs`, `github/client.mjs`, `github/discovery.mjs` and `todos.mjs`.
- Runbooks: no user flow changes.

## Acceptance

- `npm test` reports 0 failures on this machine.
- The `github-host` test passes with a folder without search permission at the front of `PATH`.
- The `cli-pr` tests pass when git has no identity from the passwd entry.
- The `validate-views` case test reads its problem by path.
