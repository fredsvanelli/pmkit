# pmkit

Project management for development agents: issues, sprints and epics in one command set across trackers. The agent calls one CLI, and an adapter translates to the team's tracker. The first tracker is the Local tracker, which keeps issues as files under `.issues/` in the repository, with no account and no network.

## Status

Core and Local tracker only. The `pmkit.mjs` CLI works. The slash commands, the routing skill, the GitHub git host and the marketplace entry come in the next plan, so the plugin is not installable from the marketplace yet. Terms are defined in [CONTEXT.md](CONTEXT.md), and the decisions are in [docs/adr](docs/adr).

## CLI

Run `node pmkit/scripts/pmkit.mjs <command>`. Every command takes `--json` and `--root <dir>`. Every write also takes `--dry-run` and `--as <member>`.

| Command | Does |
|---|---|
| `init` | writes `.pmkit/config.yaml` and scaffolds `.issues/`; refuses to overwrite |
| `capabilities` | prints the capability manifest |
| `discover` | prints statuses with categories, types, priorities, labels, members and the estimate scale |
| `whoami` | prints the resolved actor |
| `issues list` | searches issues by text, category, type, assignee, label, sprint, parent, blocked state or date |
| `issues get <id>` | shows one issue, with `--comments` and `--history` |
| `issues create` | creates an issue |
| `issues update <id>` | edits fields and acceptance criteria |
| `issues move <id> <category>` | changes status by category |
| `issues assign <id> <member\|me\|none>` | assigns an issue; `me` is the actor |
| `issues link <from> <to> --kind blocks\|related\|duplicate` | links or unlinks (`--remove`) two issues |
| `issues parent <id> <parent\|none>` | sets the parent |
| `issues comment <id> --body-file f` | adds a comment |
| `issues log-time <id> <minutes>` | logs time |
| `issues archive <id>` | archives an issue |
| `cycle list` | lists sprints |
| `cycle current` | prints the active sprint |
| `cycle issues <id>` | lists the issues of a sprint |
| `cycle open --start d` | opens a sprint; the end defaults from `sprint_length_days` |
| `cycle close <id>` | closes a sprint and prints the unfinished issues, with a warning for each issue file it could not read |
| `cycle add <id...> --to <sprint\|current\|none>` | moves issues into or out of a sprint; `current` is the active sprint |
| `cycle capacity <id>` | reads or sets capacity (`--set member=n,..`) |
| `epic list` | lists epics |
| `epic get <id>` | shows one epic |
| `epic progress <id>` | counts the issues under an epic |
| `epic create --title t` | creates an epic |
| `epic update-status <id> --health h --body-file f` | publishes a status update |
| `metrics velocity` | points or counts done per closed sprint, and the average |
| `metrics cycle-time` | median and p85 days from first `in_progress` to `done` |
| `events` | prints all events in a range, for digests |
| `validate` | checks every file and reference; problems are output, not errors |
| `pr open`, `pr status`, `pr sync` | coming in the next plan, with the GitHub git host |

Run `node pmkit/scripts/pmkit.mjs --help` for every flag. A failing command exits with code 2 and, with `--json`, prints one JSON error with a next step. An exception that is not a `PmkitError`, which means a bug in pmkit, has the code `UNEXPECTED` and no next step.

Comments and time logs append an event to the issue's `events.jsonl` but leave `issue.md` alone, so they do not change the issue's `updated` timestamp.

## Tests

    npm test

Run it from `pmkit/`. It needs Node 18 or later and installs nothing.

## Local development

    claude --plugin-dir pmkit

Run `/reload-plugins` after editing.
