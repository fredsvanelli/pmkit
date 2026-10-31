---
description: Link this repository to a git host and, on Linear, to a team, by editing .pmkit/config.yaml after one confirmation
argument-hint: "[--git-host github|none] [--repo owner/name] [--remote name] [--team KEY]"
disable-model-invocation: true
---

# Link the repository

Arguments: `$ARGUMENTS`

## Parameters

- `--git-host github|none` (optional): the git host. Without it, the command infers the host from the git remote.
- `--repo owner/name` (optional): the GitHub repository. Without it, the command reads it from the git remote.
- `--default-branch <name>` (optional): the default branch. Without it, the command reads `refs/remotes/<remote>/HEAD`, a local ref, and makes no network call.
- `--remote <name>` (optional): the remote to read. Without it, the command reads `origin`, or the only remote when there is no `origin`.
- `--team KEY` (optional, Linear only): the Linear team of this repository. The Local tracker has no scope, so `--team` fails there.

`/pmkit:link-repo` and `/pmkit:setup` differ in what they own. `/pmkit:setup` creates `.pmkit/config.yaml` and the tracker files, and asks for the prefix, the members and the status, field and label mappings. `/pmkit:link-repo` needs a config that exists and changes only the lines `git_host.system`, `git_host.repo`, `git_host.default_branch` and, on Linear, `tracker.scope.team`. Comments and the order of the file stay. Use `/pmkit:link-repo` after cloning, after the remote moves, or to point a Linear repository at another team. Use `/pmkit:setup` for a repository with no config, and for any mapping. A team change that breaks a mapping is refused here and sent to `/pmkit:setup`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" link-repo [--git-host <host>] [--repo <owner/name>] [--default-branch <name>] [--remote <name>] [--team <KEY>] --dry-run --json`, with the flags the user passed. It writes nothing. When `.pmkit/config.yaml` is not valid, the call fails with `.pmkit/config.yaml is not valid`. Apply the rules for reading errors in the conventions and stop, so the file is never written over.
2. Show one summary with `gitHost`, `repo`, `defaultBranch` and, on Linear, `scope.team`, each as before and after with its `source`. A `source` of `remote` means the value came from the git remote, `flag` from the user, and `file` that it stayed as the file has it. Repeat every entry of `notes` and `warnings` as the CLI wrote it. They say which remote was read, why nothing was inferred or changed (no remote, git unreadable, a URL or host not recognized as GitHub, several remotes without `origin`), when `default_branch` may be wrong after a repo change, and when no team is set. Show the `diff` of `.pmkit/config.yaml`. When `scope.team.verified` is `false`, say the team was not checked against the workspace.
3. When `files[0].action` is `keep`, say "already linked" and stop. When a note says nothing could be inferred, ask the user for `--git-host` and `--repo` in plain words and run step 1 again with them.
4. When a note says `default_branch` may be wrong, ask the user for the branch in plain words and run step 1 again with `--default-branch`. When a note says no team is set on Linear, offer `--team <KEY>` the same way.
5. When `broken` is not empty, the team does not fit the mappings. Show each `problem`, say the real run refuses this change, and offer `/pmkit:setup` for the mappings. Do not go on to step 6.
6. Ask once with `AskUserQuestion` whether to write the change. Ask whatever `write_policy.confirm` says, because the command changes where every other command reads and writes. When the user declines, stop and change nothing.
7. When the user approves, run the same command without `--dry-run`.
8. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" validate --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When the git host is `none`, add one line naming the commands that lose features, as step 7 of the first run of `/pmkit:setup` does.

## Confirmation points

- Step 6: the change to `.pmkit/config.yaml`. `write_policy.confirm: none` does not skip it.
- Steps 3 and 4 collect missing values and are not confirmations.

## Output

Lead with what changed in `.pmkit/config.yaml`, the git host, the repository and the team, or say "already linked". Then the `notes` and `warnings`, the result of `validate`, and the capabilities that follow from the git host.

## If something is missing

- No `.pmkit/config.yaml`: the CLI answers `NOT_CONFIGURED`. Offer `/pmkit:setup`.
- The remote cannot be read, or there is no remote: nothing is inferred and the git host stays as it is. Say so and ask for `--git-host`.
- Several remotes and no `origin`: the CLI infers nothing. Ask which remote to use and run again with `--remote`.
- A remote on a host pmkit does not recognize as GitHub (GitLab, GitHub Enterprise, an SSH alias): the command changes nothing and says why. Pass `--git-host github` for an Enterprise host or an alias, or `--git-host none` to lower the host. Only the explicit `none` lowers it.
- `LINEAR_API_KEY` is not set, or belongs to another workspace, when `--team` is given: the CLI answers `AUTH`. Follow step 3 of "Linear first run" in `/pmkit:setup`. Never ask for the key.
- An error from the CLI: apply the rules for reading errors in the conventions.
