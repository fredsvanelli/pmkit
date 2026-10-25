# pmkit

Project management for development agents: issues, sprints and epics in one command set across trackers. The agent calls one CLI, and an adapter translates to the team's tracker. The first tracker is the Local tracker, which keeps issues as files under `.issues/` in the repository, with no account and no network.

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install pmkit@fredsvanelli

Then run `/pmkit:setup` in the project. With the GitHub git host (`git_host.system: github`), pmkit creates issue branches and opens, reads and syncs pull requests through the GitHub CLI (`gh`). Terms are defined in [CONTEXT.md](CONTEXT.md), and the decisions are in [docs/adr](docs/adr).

## Commands

- `/pmkit:setup`: Set up pmkit in the project, or bring a setup in line with the installed version.
- `/pmkit:upgrade`: Update the installed pmkit plugin and move `.issues/` to the current tracker format.
- `/pmkit:help`: See what pmkit can do here, explain a capability, or find the command for a task.
- `/pmkit:backlog:groom`: Find what is wrong with the backlog and fix what the user accepts.
- `/pmkit:cycle:close`: Close the active sprint, report planned against delivered, and move the unfinished issues.
- `/pmkit:cycle:plan`: Plan the next sprint from velocity, capacity and the prioritized backlog.
- `/pmkit:issues:assign`: Assign an issue to a member, to the user or to nobody.
- `/pmkit:issues:breakdown`: Break an issue into sub-issues with estimates, order and blockers.
- `/pmkit:issues:capture`: Open an issue from what the session found (an error, a failing test, a TODO), after a duplicate check.
- `/pmkit:issues:comment`: Add a comment to an issue.
- `/pmkit:issues:create`: Create an issue, with the fields checked against the project config.
- `/pmkit:issues:find`: Find issues with a plain-language question, such as "high-priority bugs in the current sprint".
- `/pmkit:issues:link`: Link two issues (blocks, related, duplicate), remove a link, or set a parent.
- `/pmkit:issues:mine`: List the issues assigned to the user, with the state of their pull requests and the next one to pick up.
- `/pmkit:issues:move`: Move an issue to a status category: in progress, in review, done.
- `/pmkit:issues:pause`: Pause work on an issue, leave a handoff note and push a draft PR when there is code.
- `/pmkit:issues:progress`: Post what was done on an issue as a comment, tick acceptance criteria and log the time spent.
- `/pmkit:issues:summary`: Summarize an issue or an epic from its record, comments and history.
- `/pmkit:issues:update`: Change the title, priority, estimate, labels or acceptance criteria of an issue.
- `/pmkit:issues:work`: Pick up an issue: claim it, branch, plan, implement, open the PR and move it to review.
- `/pmkit:local:doctor`: Check the tracker files, fix what can be fixed and resolve git conflict markers.
- `/pmkit:report:status`: Draft a status update for an epic and publish it after approval.
- `/pmkit:spec:import`: Turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers.
- `/pmkit:team:standup`: Digest of what changed since the last business day, per person, with what needs attention.

## CLI

Run `node scripts/pmkit.mjs <command>`. Every command takes `--json` and `--root <dir>`. Every write also takes `--dry-run` and `--as <member>`.

With `auto_commit: true` in `.issues/config.yaml`, each write commits the files it changed as `pmkit: <command> <id>`. With `auto_commit: false`, the default, no command commits. `--dry-run`, `init`, `pr open` and `pr ready` never commit.

| Command | Does |
|---|---|
| `init` | writes `.pmkit/config.yaml` and scaffolds `.issues/`; refuses to overwrite. Flags: `--tracker local`, `--git-host github\|none`, `--prefix`, `--id-style random\|numbered`, `--estimate-unit points\|hours\|sizes`, `--member id --name n --email e`, `--members-file f\|-` |
| `init --update` | edits only the lines its flags name; `--replace <path>` overwrites a template file that differs |
| `capabilities` | prints the capability manifest |
| `discover` | prints statuses with categories, types, priorities, labels, members and the estimate scale |
| `whoami` | prints the resolved actor |
| `issues list` | searches issues by text, category, type, assignee, label, sprint, parent, blocked state or date, oldest created first unless `--sort` says otherwise |
| `issues get <id>` | shows one issue, with `--comments` and `--history` |
| `issues create` | creates an issue; takes `--milestone` |
| `issues update <id>` | edits fields and acceptance criteria; `--milestone` and `--branch` take `none` to clear |
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
| `epic updates <id>` | lists the status updates of an epic, newest first |
| `docs read <path>` | prints a document under the docs folder |
| `docs create <path> --body-file f` | creates a document under the docs folder |
| `metrics velocity` | points or counts done per closed sprint, and the average |
| `metrics cycle-time` | median and p85 days from first `in_progress` to `done` |
| `events` | prints all events in a range, for digests |
| `issues branch <id> [--from branch]` | creates the issue branch from `--from` (default: `git_host.default_branch`) and records it on the issue |
| `pr open --issue <id> [--draft] [--body-file f]` | pushes the issue branch and opens a pull request; when the branch already has an open one, pushes and returns it with `existing: true` |
| `pr ready --issue <id>` | marks the open draft pull request of an issue ready for review |
| `pr status [--branch b]` | the pull request, checks and reviews of a branch (default: the current branch) |
| `pr sync` | moves `in_review` issues to `done` when their pull request is merged |
| `changelog --file f --since v` | prints the `CHANGELOG.md` sections newer than a version, oldest first; needs no config |
| `migrate` | moves the tracker files to the format this pmkit writes; `--dry-run` lists every file it would touch |
| `validate` | checks every file and reference; problems are output, not errors |

The `issues branch` and `pr` commands need `git_host.system: github` in `.pmkit/config.yaml` and a logged-in `gh`. Without them they fail with `NOT_SUPPORTED`, `NOT_CONFIGURED` or `AUTH`. Run `node scripts/pmkit.mjs --help` for every flag. A failing command exits with code 2 and, with `--json`, prints one JSON error with a next step. An exception that is not a `PmkitError`, which means a bug in pmkit, has the code `UNEXPECTED` and no next step.

Comments and time logs append an event to the issue's `events.jsonl` but leave `issue.md` alone, so they do not change the issue's `updated` timestamp.

## Tests

    npm test

Run it from the repository root. It needs Node 18 or later and installs nothing.

## Local development

    claude --plugin-dir .

Run `/reload-plugins` after editing.
