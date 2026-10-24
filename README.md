# pmkit

Project management for development agents: issues, sprints and epics in one command set across trackers. The agent calls one CLI, and an adapter translates to the team's tracker. The first tracker is the Local tracker, which keeps issues as files under `.issues/` in the repository, with no account and no network.

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install pmkit@fredsvanelli

Then run `/pmkit:setup` in the project. The GitHub git host (`pmkit pr open`, `pr status`, `pr sync`) comes in a later release. Terms are defined in [CONTEXT.md](CONTEXT.md), and the decisions are in [docs/adr](docs/adr).

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
- `/pmkit:issues:mine`: List the issues assigned to the user, in the order to pick them up, with the state of their pull requests.
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
