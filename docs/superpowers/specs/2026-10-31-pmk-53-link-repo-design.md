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

`pmkit link-repo [--git-host github|none] [--repo owner/name] [--remote <name>] [--team KEY] [--dry-run]`

It needs `.pmkit/config.yaml` (`NOT_CONFIGURED` otherwise, next step `/pmkit:setup`). It does not read `.issues/`. A config that does not parse or does not validate makes the dry run and the write fail with the `.pmkit/config.yaml is not valid` error, and nothing is written.

### Git host

Resolution order for each value: the flag, then the git remote, then the value in the file.

Reading the remotes: `git remote`, then `git remote get-url <name>` for each, with a timeout, since both are reads. When git fails (not a repository, no git binary), the remote state is unknown. The command infers nothing, changes nothing in `git_host`, and says why.

Choosing the remote:

- `--remote <name>` picks it. An unknown name is `INVALID_INPUT` with the list of remotes.
- Otherwise `origin`.
- Without `origin` and with exactly one remote, that remote, with a note.
- Without `origin` and with several, the command cannot choose. It infers nothing, lists the remotes with their hosts in `remotes` and in a note, and tells the user to pass `--remote` or `--git-host`.
- With no remote, nothing is inferred and `git_host` stays as it is, with a note. This differs from `/pmkit:setup`, which writes `none` on a first run, because here a config already exists and a clone with no remote yet says nothing about the real host.
- With several remotes and `origin` among them, `origin` is used and a note names the others.

Parsing a URL (`scripts/lib/git-remote.mjs`): `https://[user@]host[:port]/owner/repo[.git][/]`, `http://`, `ssh://[user@]host[:port]/owner/repo[.git]`, `git://`, and the scp form `[user@]host:owner/repo[.git]`. The host is lowercased. A URL that does not parse gives host `null`, and the command infers nothing and says the URL is not recognized.

The host `github.com` (and `www.github.com`) means `github`, with `repo` set to `owner/name`. Any other host means `none`, with a note that names the host and says pmkit supports only GitHub for now. GitHub Enterprise hosts count as other hosts.

Flags override: `--git-host` sets the system, `--repo` sets `git_host.repo` and must look like `owner/name`. `--git-host github` with a remote on another host is accepted, with a warning. `--repo` with `--git-host none` is `INVALID_INPUT`. When the host ends up `none`, `git_host.repo` is removed from the file, since it names a repository nothing uses. When the host stays `github` and no repo is known, `git_host.repo` is left as it is.

### Scope

- Local: the tracker has no scope. `--team` is `INVALID_INPUT` ("the Local tracker has no scope").
- Linear: `--team KEY` is checked against the workspace with the same discovery `/pmkit:setup` runs (`init --update --team`). An unknown team is `INVALID_INPUT` listing the teams. Without `--team`, the file's team stays when the workspace still has it. When the file has no team, the team the viewer belongs to is used if there is only one, as setup does. Otherwise `questions` holds `tracker.scope.team` with candidates, and the real run refuses to write, as `init` does.
- A new team can break the mappings (statuses, fields, labels are per team). The dry run lists them in `broken`, and the real run refuses with `NOT_CONFIGURED`-style next step `/pmkit:setup`, so the config never ends up pointing at a team its own mappings do not fit. Setup is the command that asks for mappings.
- Authentication or network errors from the discovery stop the command before any write. A read that comes back incomplete is never a reason to write.

### Output

`--json` returns `{ dryRun, tracker, remote, remotes, gitHost: { before, after, source }, repo: { before, after, source }, scope: { team: { before, after, source } | null }, questions, broken, notes, warnings, files }`. `source` is `flag`, `remote`, `file` or `none`. `files` has one entry, `.pmkit/config.yaml`, with `action` (`change` or `keep`) and the diff. `notes` repeats every `note:` line, so the agent reads them in the JSON too. A write that changes nothing says "already linked" and writes nothing.

The command is exempt from the standard config check, because it reads only `.pmkit/config.yaml` and does its own refusal for an invalid file.

## The command file

`commands/link-repo.md`, `/pmkit:link-repo [--git-host github|none] [--repo owner/name] [--team KEY]`. Steps: run the dry run, show before and after of each field with its source and each `note:` as printed, ask once, then write and run `validate` and `capabilities`. The question is always asked, whatever `write_policy.confirm` says, because the command changes where every other command reads and writes (a scope move). Declining changes nothing.

## Decisions

- A new CLI command instead of extending `init --update`: `init` is for setup and for the Local scaffold, and cannot infer on an update, set the repo or remove a key.
- Always confirm, even with `write_policy.confirm: none`.
- `link-repo` does not move between trackers and does not touch mappings. A team change that breaks mappings is refused and sent to setup.
- No remote leaves the file alone. An unreadable remote list is "unknown", never "no remote".
- `default_branch` is not written: no command reads it, and it cannot be inferred without a network call.
- Capability: no new row. The command is not a tracker operation, so `SERVED_BY` and the ADR-0001 counts do not change.
- `yaml-edit.mjs` gains `removeKey`, with tests, for the `none` case.

## Tests

- `scripts/lib/git-remote.test.mjs`: URL parsing and the choice of remote.
- `scripts/yaml-edit.test.mjs`: `removeKey`.
- `scripts/cli-link-repo.test.mjs`: Local and Linear, every URL form through a real git repository, several remotes, no remote, not a repository, an invalid config, dry run versus write, comments and key order preserved, the Linear team check, broken mappings, CRLF.
- A scenario `scripts/__scenarios__/link-repo.mjs`, the counts of command files, `COMMANDS` in `plugin.test.mjs`, the README and skill tables, and the CHANGELOG line.
