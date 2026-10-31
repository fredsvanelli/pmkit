# PMK-53 design: the link-repo command

Source: Unified model, Foundation catalog (`link-repo`: "Links the repository to a system, scope and default git host"; degradation "Inferred from the git remote when possible"); Linear tab ("This repo belongs to team ENG").

This design was written without a round of questions. The calls the builder made are listed in "Decisions", and each one can change in review.

## Goal

- A CLI command, `pmkit link-repo`, that writes the git host and the tracker scope to `.pmkit/config.yaml` and leaves every other line, comment and the order of the file as it was.
- A command file, `/pmkit:link-repo`, that shows the dry run, asks once and writes.
- The git host comes from the git remote when the user passes none. The user can pass every value.

## Non-goals

- No change to the tracker system. `/pmkit:setup` does that, and it refuses to switch trackers.
- No change to the Local tracker store, to mappings of statuses, fields or labels, or to `.issues/config.yaml`.
- No git host other than `github` and `none`.

## link-repo and /pmkit:setup

`/pmkit:setup` creates the config and the tracker files, and asks for the prefix, the members and the mappings. `/pmkit:link-repo` changes two things in a config that exists: which git host and repository this clone belongs to, and, on Linear, which team. Use `link-repo` after cloning, after a move of the remote, or to point the repository at another team. Use `setup` for a repository that has no config, and for any mapping.

## The CLI command

`pmkit link-repo [--git-host github|none] [--repo owner/name] [--default-branch name] [--remote <name>] [--team KEY] [--dry-run]`

It needs `.pmkit/config.yaml` (`NOT_CONFIGURED` otherwise, next step `/pmkit:setup`). It does not read `.issues/`. A config that does not parse or does not validate makes the dry run and the write fail with the `.pmkit/config.yaml is not valid` error, and nothing is written.

### Git host

Resolution order for each value: the flag, then the git remote, then the value in the file.

Reading the remotes: one `git remote -v` call, with a timeout and a 1 MiB output limit, since it is a read. The fetch URL of each remote is the one used. When git fails (not a repository, no git binary), the remote state is unknown. The command infers nothing, changes nothing in `git_host`, and says why.

Choosing the remote:

- `--remote <name>` picks it. An unknown name is `INVALID_INPUT` with the list of remotes.
- Otherwise `origin`.
- Without `origin` and with exactly one remote, that remote, with a note.
- Without `origin` and with several, the command cannot choose. It infers nothing, lists the remotes with their hosts in `remotes` and in a note, and tells the user to pass `--remote` or `--git-host`.
- With no remote, nothing is inferred and `git_host` stays as it is, with a note. This differs from `/pmkit:setup`, which writes `none` on a first run, because here a config already exists and a clone with no remote yet says nothing about the real host.
- With several remotes and `origin` among them, `origin` is used and a note names the others.

Parsing a URL (`scripts/lib/git-remote.mjs`): `https://[user@]host[:port]/owner/repo[.git][/]`, `http://`, `ssh://[user@]host[:port]/owner/repo[.git]`, `git://`, and the scp form `[user@]host:owner/repo[.git]`. The host is lowercased. A URL that does not parse gives host `null`, and the command infers nothing and says the URL is not recognized.

The hosts `github.com`, `www.github.com` and `ssh.github.com` (GitHub over port 443) mean `github`, with `repo` set to `owner/name`. A path with more than two segments is not a GitHub repository and is not recognized. A URL with a broken percent escape (`100%.git`) is not recognized and never throws.

An inference never lowers a configured host. When the remote's host is not one of those (GitLab, GitHub Enterprise, an SSH alias), or the URL does not parse, the command leaves `git_host.system` and `git_host.repo` as they are and says why in a `note:`, naming `--git-host github` for an Enterprise host or an alias and `--git-host none` to lower the host. Only an explicit `--git-host none` writes `none`.

Flags override: `--git-host` sets the system, `--repo` sets `git_host.repo` and must look like `owner/name` (`a/b/c` is `INVALID_INPUT`, and so is an inferred path that is not `owner/name`, which is not inferred at all). `--git-host github` with a remote on another host is accepted, with a warning. `--repo` with `--git-host none` is `INVALID_INPUT`. With an explicit `--git-host none`, `git_host.repo` is removed from the file, since it names a repository nothing uses. When the host is `github` and no repo is known, `git_host.repo` is left as it is.

### Default branch

`pr diff`, `issues branch`, `issues progress`, `pause` and `review` read `git_host.default_branch`, so the command keeps it right. It comes from `--default-branch <name>`, else from `git symbolic-ref --quiet refs/remotes/<chosen remote>/HEAD`, a local ref that needs no network, and only when the remote is recognized as GitHub. It is written when it differs from the file. A name that is not a plain branch name is `INVALID_INPUT`, and `--default-branch` with `--git-host none` is too. When the repo changes (the file had one and the new one differs) and the branch cannot be inferred and no flag gave it, the old value stays and a `note:` says `default_branch <old> may be wrong`, with `--default-branch <name>` and `git remote set-head <remote> --auto` as the fixes. Keeping the value was chosen over removing it, because a removed key makes every reader fall back silently, while a kept value with a note shows the user what to check. The JSON has `defaultBranch: { before, after, source }`.

### Scope

- Local: the tracker has no scope. `--team` is `INVALID_INPUT` ("the Local tracker has no scope").
- Linear: `--team KEY` is checked against the workspace with the same discovery `/pmkit:setup` runs (`init --update --team`). An unknown team is `INVALID_INPUT` listing the teams. Without `--team` the command never calls Linear, whether the file has a team or not, so a host change needs no key, no network and no team, and the dry run and the write give the same result. The result says the team was not checked (`verified: false`), and `/pmkit:setup` is the command that re-checks a team. When the file has no team, a `note:` says `tracker.scope.team is not set`. The command no longer picks a team for the user.
- A new team can break the mappings (statuses, fields, labels are per team). The dry run lists them in `broken`, and the real run refuses with `NOT_CONFIGURED`-style next step `/pmkit:setup`, so the config never ends up pointing at a team its own mappings do not fit. Setup is the command that asks for mappings.
- Authentication or network errors from the discovery stop the command before any write. A read that comes back incomplete is never a reason to write.

### Output

`--json` returns `{ dryRun, tracker, remote, remotes, gitHost: { before, after, source }, repo: { before, after, source }, defaultBranch: { before, after, source }, scope: { team: { before, after, source, verified } } | null, broken, notes, warnings, files }`. `source` is `flag`, `remote` or `file`. `files` has one entry, `.pmkit/config.yaml`, with `action` (`change` or `keep`) and the diff. `notes` repeats every `note:` line, so the agent reads them in the JSON too. A write that changes nothing says "already linked" and writes nothing.

The command is exempt from the standard config check, because it reads only `.pmkit/config.yaml` and does its own refusal for an invalid file.

## The command file

`commands/link-repo.md`, `/pmkit:link-repo [--git-host github|none] [--repo owner/name] [--team KEY]`. Steps: run the dry run, show before and after of each field with its source and each `note:` as printed, ask once, then write and run `validate` and `capabilities`. The question is always asked, whatever `write_policy.confirm` says, because the command changes where every other command reads and writes (a scope move). Declining changes nothing.

## Decisions

- A new CLI command instead of extending `init --update`: `init` is for setup and for the Local scaffold, and cannot infer on an update, set the repo or remove a key.
- Always confirm, even with `write_policy.confirm: none`.
- `link-repo` does not move between trackers and does not touch mappings. A team change that breaks mappings is refused and sent to setup.
- No remote leaves the file alone. An unreadable remote list is "unknown", never "no remote".
- `default_branch` is written, from `--default-branch` or the local `refs/remotes/<remote>/HEAD`. An earlier draft left it out on the claim that no command reads it, which was wrong (see "Default branch").
- A host the command does not recognize never changes the configured host. The earlier draft wrote `none` and removed the repo, which lowered a working GitHub Enterprise or SSH-alias setup.
- Capability: no new row. The command is not a tracker operation, so `SERVED_BY` and the ADR-0001 counts do not change.
- `yaml-edit.mjs` gains `removeKey`, with tests, for the `none` case.

## Tests

- `scripts/lib/git-remote.test.mjs`: URL parsing and the choice of remote.
- `scripts/yaml-edit.test.mjs`: `removeKey`.
- `scripts/cli-link-repo.test.mjs`: Local and Linear, every URL form through a real git repository, several remotes, no remote, not a repository, an invalid config, dry run versus write, comments and key order preserved, the Linear team check, broken mappings, CRLF.
- A scenario `scripts/__scenarios__/link-repo.mjs`, the counts of command files, `COMMANDS` in `plugin.test.mjs`, the README and skill tables, and the CHANGELOG line.
