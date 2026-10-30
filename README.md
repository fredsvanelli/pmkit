# pmkit

Project management for development agents: issues, sprints and epics in one command set across trackers. The agent calls one CLI, and an adapter translates to the team's tracker. The first tracker is the Local tracker, which keeps issues as files under `.issues/` in the repository, with no account and no network.

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install pmkit@fredsvanelli

Then run `/pmkit:setup` in the project. It asks whether the issues live in the Local tracker or in a Linear workspace. The Linear path needs a personal API key in `LINEAR_API_KEY` and asks for the team, the status that means in review, the status that means blocked and the label of each issue type. With the GitHub git host (`git_host.system: github`), pmkit creates issue branches and opens, reads and syncs pull requests through the GitHub CLI (`gh`). Terms are defined in [CONTEXT.md](CONTEXT.md), and the decisions are in [docs/adr](docs/adr).

## Commands

- `/pmkit:setup`: Set up pmkit in the project, or bring a setup in line with the installed version.
- `/pmkit:upgrade`: Update the installed pmkit plugin and move `.issues/` to the current tracker format.
- `/pmkit:help`: See what pmkit can do here, explain a capability, or find the command for a task.
- `/pmkit:backlog:groom`: Find what is wrong with the backlog and fix what the user accepts.
- `/pmkit:backlog:triage`: Triage the issues nobody has looked at and apply the decisions the user accepts.
- `/pmkit:cycle:close`: Close the active sprint, report planned against delivered, and move the unfinished issues.
- `/pmkit:cycle:plan`: Plan the next sprint from velocity, capacity and the prioritized backlog.
- `/pmkit:issues:assign`: Assign an issue to a member, to the user or to nobody.
- `/pmkit:issues:breakdown`: Break an issue into sub-issues with estimates, order and blockers.
- `/pmkit:issues:capture`: Open an issue from what the session found (an error, a failing test, a TODO), after a duplicate check.
- `/pmkit:issues:comment`: Add a comment to an issue.
- `/pmkit:issues:create`: Create an issue from an idea, refined into context, scope, tasks and acceptance criteria, with the fields checked against the project config.
- `/pmkit:issues:delegate`: Delegate an issue to an agent: assign it to `agent:<name>`, post the instructions, and run the agent locally only when you say so.
- `/pmkit:issues:dependencies`: Show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path.
- `/pmkit:issues:estimate`: Propose an estimate for an issue from the code it affects and from similar completed issues, and save it after confirmation.
- `/pmkit:issues:find`: Find issues with a plain-language question, such as "high-priority bugs in the current sprint".
- `/pmkit:issues:link`: Link two issues (blocks, related, duplicate), remove a link, or set a parent.
- `/pmkit:issues:mine`: List the issues assigned to the user, with the state of their pull requests and the next one to pick up.
- `/pmkit:issues:move`: Move an issue to a status category: in progress, in review, done.
- `/pmkit:issues:pause`: Pause work on an issue, leave a handoff note and push a draft PR when there is code.
- `/pmkit:issues:progress`: Post what was done on an issue as a comment, tick acceptance criteria and log the time spent.
- `/pmkit:issues:review`: Review the pull request of an issue against its acceptance criteria, flag the gaps and post the result after approval.
- `/pmkit:issues:todos`: Turn the TODO and FIXME comments of the repository into issues, dropping the ones an issue already covers, after a full preview.
- `/pmkit:issues:summary`: Summarize an issue or an epic from its record, comments and history.
- `/pmkit:issues:unblock`: List what blocks a pull request from merging (checks, reviews, conflicts, open threads and policies) and the next step for each.
- `/pmkit:issues:update`: Change the title, priority, estimate, labels or acceptance criteria of an issue.
- `/pmkit:issues:work`: Pick up an issue: claim it, branch, plan, implement, open the PR and move it to review.
- `/pmkit:linear:customers`: List and edit Linear customers (tier, revenue, size, status) and link customer requests to issues and projects.
- `/pmkit:linear:triage-rotation`: See who is on triage duty in Linear, change the rotation, and read Linear's Triage Intelligence suggestions.
- `/pmkit:local:doctor`: Check the tracker files, fix what can be fixed and resolve git conflict markers.
- `/pmkit:local:render`: Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent.
- `/pmkit:local:migrate`: Move the Local tracker to a Linear team, import a Linear team into .issues/, undo an export, or switch pmkit to the new tracker.
- `/pmkit:report:release-notes`: Write release notes for a release, a sprint or a period, and save them after you confirm.
- `/pmkit:report:status`: Draft a status update for an epic and publish it after approval.
- `/pmkit:spec:import`: Turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers.
- `/pmkit:team:flow-metrics`: Show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period.
- `/pmkit:team:risk-radar`: Blockers, stalled issues and PRs, late epics, epics without a recent status update and broken CI, in one read-only report.
- `/pmkit:team:standup`: Digest of what changed since the last business day, per person, with what needs attention.

## CLI

Run `node scripts/pmkit.mjs <command>`. Every command takes `--json` and `--root <dir>`. Every write also takes `--dry-run` and `--as <member>`.

With `auto_commit: true` in `.issues/config.yaml`, each write commits the files it changed as `pmkit: <command> <id>`. With `auto_commit: false`, the default, no command commits. `--dry-run`, `init`, `pr open` and `pr ready` never commit.

| Command | Does |
|---|---|
| `init` | writes `.pmkit/config.yaml` and scaffolds `.issues/`; refuses to overwrite. Flags: `--tracker local\|linear`, `--git-host github\|none`, `--workspace`, `--team`, `--status key=name`, `--field key=value`, `--type-label type=label`, `--prefix`, `--id-style random\|numbered`, `--estimate-unit points\|hours\|sizes`, `--label name`, `--member id --name n --email e`, `--members-file f\|-` |
| `init --tracker linear` | reads the Linear workspace with the key in `LINEAR_API_KEY`, applies what it can infer, lists what it must ask and writes only `.pmkit/config.yaml`. `--dry-run` returns `applied`, `questions` and `broken`; the answers go back as `--team`, `--status`, `--field` and `--type-label` |
| `init --update` | edits only the lines its flags name and adds or updates the schema line in the config files; `--replace <path>` overwrites a template file that differs |
| `capabilities` | prints the capability manifest |
| `discover` | prints statuses with categories, types, priorities, labels, members and the estimate scale |
| `whoami` | prints the resolved actor |
| `issues list` | searches issues by text, category, type, assignee, label, sprint, parent, blocked state or date, oldest created first unless `--sort` says otherwise |
| `issues get <id>` | shows one issue, with `--comments` and `--history` |
| `issues dependencies <id>` | shows the blocker chain, the hierarchy and the critical path of an issue or an epic; only reads |
| `issues create` | creates an issue; takes `--milestone` and `--release` |
| `issues update <id>` | edits fields and acceptance criteria; `--milestone`, `--release` and `--branch` take `none` to clear |
| `issues move <id> <category>` | changes status by category |
| `issues assign <id> <member\|me\|none>` | assigns an issue; `me` is the actor |
| `issues delegate <id> <agent:name>` | assigns an issue to an agent member and comments the instructions for local execution; `--instructions-file` holds them |
| `issues link <from> <to> --kind blocks\|related\|duplicate` | links or unlinks (`--remove`) two issues |
| `issues parent <id> <parent\|none>` | sets the parent |
| `issues comment <id> --body-file f` | adds a comment |
| `issues log-time <id> <minutes>` | logs time |
| `issues time-entries <id>` | lists the time logged on an issue, with the total |
| `issues archive <id>` | archives an issue |
| `cycle list` | lists sprints |
| `cycle current` | prints the active sprint |
| `cycle issues <id>` | lists the issues of a sprint |
| `cycle open --start d` | opens a sprint; the end defaults from `sprint_length_days` |
| `cycle close <id>` | closes a sprint and prints the unfinished issues, with a warning for each issue file it could not read |
| `cycle add <id...> --to <sprint\|current\|none>` | moves issues into or out of a sprint; `current` is the active sprint |
| `cycle capacity <id>` | reads or sets capacity and days off (`--set member=n,..`, `--days-off member=date+date,..`) |
| `epic list` | lists epics |
| `epic get <id>` | shows one epic |
| `epic progress <id>` | counts the issues under an epic |
| `epic create --title t` | creates an epic; `--goal <id>` links it to a goal |
| `epic goal <id> <goal\|none>` | links an epic to a goal, or removes the link with `none` |
| `epic update-status <id> --health h --body-file f` | publishes a status update |
| `epic updates <id>` | lists the status updates of an epic, newest first |
| `milestone list` | lists milestones, by due date |
| `milestone get <id>` | shows one milestone |
| `milestone create <id>` | creates a milestone; takes `--name` and `--due` |
| `release list` | lists releases, oldest version first; `--state planned\|released` |
| `release get <id>` | shows one release |
| `release issues <id> [--archived]` | lists the issues of a release; `--archived` keeps the archived ones |
| `release create <id>` | creates a release; takes `--name`, `--tag` and `--target` |
| `release mark-released <id>` | marks a release released, lists its unfinished issues and warns when its tag is not in the repository; takes `--tag` |
| `release-notes [--release id \| --sprint id\|current \| --since d [--until d]]` | the done issues of a release, a sprint or a period, grouped by type, with the basis it used; only reads |
| `docs list` | lists the documents under the docs folder |
| `docs read <path>` | prints a document under the docs folder |
| `docs create <path> --body-file f` | creates a document under the docs folder |
| `views save <name> [filter flags] [--overwrite]` | saves an issue filter as `.issues/views/<name>.yaml`; takes the flags of `issues list`, and refuses a name that exists unless `--overwrite` |
| `views list` | lists the saved views with their filters |
| `goal list` | lists the goals in `.issues/goals/` with the epics linked to each |
| `goal get <id>` | shows one goal and its epics |
| `goal create --title t [--target YYYY-MM-DD]` | creates a goal as `.issues/goals/<ID>.md`; the ID is `GOAL-` and a code that follows `id_style` |
| `goal progress <id>` | adds up the progress of the epics linked to a goal, as `epic progress` counts each one |
| `views run <name>` | runs a saved view and lists its issues; `sprint: current` and `assignee: me` stay symbolic, so they resolve when the view runs |
| `metrics velocity` | points or counts done per closed sprint, and the average |
| `metrics cycle-time` | median and p85 days from first `in_progress` to `done` |
| `metrics lead-time` | median and p85 days from creation to `done` |
| `metrics throughput` | issues done in a range, with a count per type |
| `metrics aging` | days since work started for each issue in `in_progress` or `in_review` at `--until` (default now), oldest first |
| `events` | prints all events in a range, for digests |
| `risks` | blockers, stalled issues and PRs, late epics, epics without a recent status update and broken CI; reads only. With `git_host.system: none`, or when `gh` is missing or logged out, it lists issues stalled by tracker activity and marks pull requests and CI as not checked |
| `team load [--sprint current\|id]` | issues, estimate points and work in progress per member for the active sprint, or for all open work when no sprint is active, with imbalances (above 1.5 times the average, over sprint capacity), members with no work and a proposal of moves; counts issues when estimates are off or absent; only reads |
| `alerts list [--severity s,..]` | security alerts from the scanners the repository has, highest severity first: `npm audit` when there is a `package-lock.json` or `npm-shrinkwrap.json`. Severity is `critical`, `high`, `medium` or `low`. A scanner that fails is a warning, and the text output says the result is incomplete; reads only |
| `issues branch <id> [--from branch]` | creates the issue branch from `--from` (default: `git_host.default_branch`) and records it on the issue |
| `pr open --issue <id> [--draft] [--body-file f]` | pushes the issue branch and opens a pull request; when the branch already has an open one, pushes and returns it with `existing: true` |
| `pr ready --issue <id>` | marks the open draft pull request of an issue ready for review |
| `pr status [--branch b]` | the pull request, checks and reviews of a branch (default: the current branch) |
| `todos scan [--path folder-or-file]` | TODO and FIXME comments in the files the repository lists (tracked, and untracked but not ignored), grouped by text. A tag counts only as the first word of a comment in a known language, and Markdown only inside `<!-- -->`. It skips `node_modules`, the tracker folder, symbolic links, binaries and files over 1 MiB, and drops the comments an issue matches by its `todo-key:` line or by the comment text as whole words. `--path` takes one folder (with everything under it) or one file inside the repository. A skipped-type count (`skipped.unsupported`) and a warning list the files it did not read. `incomplete` in the JSON says the tracker read was cut; reads only |
| `pr blockers [--branch b]` | what blocks the pull request of a branch: failing and pending checks, changes requested and requested reviewers, merge conflicts, open review threads and unmet branch protection rules. A read GitHub refuses, such as branch protection without admin rights, is listed in `unchecked` |
| `pr diff [--branch b] [--base b] [--max-lines n]` | the diff of the open or merged pull request of a branch (default: the current branch). Without one, or when GitHub refuses a diff that is too large, the local diff against `origin/<base>` (default `git_host.default_branch`), with the uncommitted changes of tracked files for the checked out branch. A `note:` says which case applied. Keeps the first `--max-lines` lines (default 2000); reads only |
| `pr sync` | moves `in_review` issues to `done` when their pull request is merged |
| `deploys list [--environment e] [--limit n]` | the repository deployments (default 20, at most 100) with the state of the latest status of each; reads only |
| `ci logs [--branch b] [--run id] [--tail n]` | the log of the failed steps of a workflow run: `--run`, or the newest failed run of a branch (default: the current branch); keeps the last `--tail` lines (default 200); reads only |
| `changelog --file f --since v` | prints the `CHANGELOG.md` sections newer than a version, oldest first; needs no config |
| `migrate` | moves the tracker files to the format this pmkit writes; `--dry-run` lists every file it would touch |
| `reindex` | rebuilds the query index in `.issues/.cache/` from the issue files; changes only files git ignores |
| `render <board\|roadmap\|sprint>` | renders a view as Markdown or HTML to stdout, to `--out f`, or with `--save` to `.issues/.cache/render/`, which git ignores; never replaces a file it did not render |
| `validate` | checks every file and reference; problems are output, not errors |

The `issues branch` and `pr` commands need `git_host.system: github` in `.pmkit/config.yaml` and a logged-in `gh`. With `git_host.system: none` they fail with `NOT_SUPPORTED`, and without `gh` or its login they fail with `NOT_CONFIGURED` or `AUTH`. A missing or invalid `git_host` makes `.pmkit/config.yaml` invalid. Then `issues branch`, `pr open`, `pr ready` and `pr sync` refuse with `INVALID_INPUT`, as every write does, and `pr status` prints a warning and fails with `NOT_SUPPORTED`. Run `node scripts/pmkit.mjs --help` for every flag. A failing command exits with code 2 and, with `--json`, prints one JSON error with a next step. An exception that is not a `PmkitError`, which means a bug in pmkit, has the code `UNEXPECTED` and no next step.

Comments and time logs append an event to the issue's `events.jsonl` but leave `issue.md` alone, so they do not change the issue's `updated` timestamp.

Editors can check the config files against JSON Schemas. The schemas live in `schemas/` (`pmkit.config.schema.json` for `.pmkit/config.yaml` and `issues.config.schema.json` for `.issues/config.yaml`). `/pmkit:setup` and `init` write a `# yaml-language-server: $schema=` line as the first line of each config file. The line points at the schemas on `main` on GitHub. The Red Hat YAML extension in VS Code and JetBrains IDEs read it, and the CLI ignores it.

## Tests

    npm test

Run it from the repository root. It needs Node 18 or later and installs nothing.

## Local development

    claude --plugin-dir .

Run `/reload-plugins` after editing.
