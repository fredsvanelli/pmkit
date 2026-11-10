# pmkit

Project management for development agents: issues, sprints and epics in one command set across trackers. The agent calls one CLI, and an adapter translates to the team's tracker. The first tracker is the Local tracker, which keeps issues as files under `.issues/` in the repository, with no account and no network.

## Install

    claude plugin marketplace add fredsvanelli/skills
    claude plugin install pmkit@fredsvanelli

Then run `/pmkit:setup` in the project. It asks whether the issues live in the Local tracker or in a Linear workspace. The Linear path needs a personal API key in `LINEAR_API_KEY` and asks for the team, the status that means in review, the status that means blocked and the label of each issue type. With the GitHub git host (`git_host.system: github`), pmkit creates issue branches and opens, reads and syncs pull requests through the GitHub CLI (`gh`). Terms are defined in [CONTEXT.md](CONTEXT.md), and the decisions are in [docs/adr](docs/adr).

## Commands

- `/pmkit:setup`: Set up pmkit in the project, or bring a setup in line with the installed version.
- `/pmkit:link-repo`: Link this repository to a git host and, on Linear, to a team, by editing `.pmkit/config.yaml` after one confirmation.
- `/pmkit:upgrade`: Update the installed pmkit plugin and move `.issues/` to the current tracker format.
- `/pmkit:help`: See what pmkit can do here, explain a capability, or find the command for a task.
- `/pmkit:backlog:groom`: Find what is wrong with the backlog and fix what the user accepts.
- `/pmkit:backlog:triage`: Triage the issues nobody has looked at and apply the decisions the user accepts.
- `/pmkit:backlog:prioritize-by-demand`: Rank the open issues by customer requests, or by comments and mentions when there are none, and change their priorities after a full preview, or only show the ranking.
- `/pmkit:backlog:request-queue`: Work the open requests into new issues, links to existing issues or declines, after a full preview; without a request queue it suggests triage.
- `/pmkit:cycle:close`: Close the active sprint, report planned against delivered, and move the unfinished issues.
- `/pmkit:cycle:plan`: Plan the next sprint from velocity, capacity and the prioritized backlog.
- `/pmkit:issues:assign`: Assign an issue to a member, to the user or to nobody.
- `/pmkit:issues:breakdown`: Break an issue into sub-issues with estimates, order and blockers.
- `/pmkit:issues:bulk`: Apply one change to every issue a filter or saved view returns, after a full preview that the write cannot differ from.
- `/pmkit:issues:run-view`: Run a saved view by name and show its issues table.
- `/pmkit:issues:inbox-digest`: What needs your attention: mentions, new assignments and reviews waiting for you. Reads only.
- `/pmkit:issues:capture`: Open an issue from what the session found (an error, a failing test, a TODO), after a duplicate check.
- `/pmkit:issues:comment`: Add a comment to an issue.
- `/pmkit:issues:create`: Create an issue from an idea, refined into context, scope, tasks and acceptance criteria, with the fields checked against the project config.
- `/pmkit:issues:delegate`: Delegate an issue to an agent: hand it to `agent:<name>`, post the instructions, and run the agent locally only when you say so. On Linear the agent becomes the issue's delegate and Linear runs it.
- `/pmkit:issues:delete`: Delete an issue for good after a full preview, refusing while other issues reference it. Archive keeps the issue instead.
- `/pmkit:issues:dependencies`: Show what blocks an issue or an epic, with the blocker chain, the hierarchy and the critical path.
- `/pmkit:issues:estimate`: Propose an estimate for an issue from the code it affects and from similar completed issues, and save it after confirmation.
- `/pmkit:issues:find`: Find issues with a plain-language question, such as "high-priority bugs in the current sprint".
- `/pmkit:issues:link`: Link two issues (blocks, related, duplicate), remove a link, or set a parent.
- `/pmkit:issues:log-time`: Log time worked on an issue after confirmation and show its total, or suggest a comment when the tracker has no time tracking.
- `/pmkit:issues:mine`: List the issues assigned to the user, with the state of their pull requests and the next one to pick up.
- `/pmkit:issues:move`: Move an issue to a status category: in progress, in review, done.
- `/pmkit:issues:pause`: Pause work on an issue, leave a handoff note and push a draft PR when there is code.
- `/pmkit:issues:progress`: Post what was done on an issue as a comment, tick acceptance criteria and log the time spent.
- `/pmkit:issues:review`: Review the pull request of an issue against its acceptance criteria, flag the gaps and post the result after approval.
- `/pmkit:issues:todos`: Turn the TODO and FIXME comments of the repository into issues, dropping the ones an issue already covers, after a full preview.
- `/pmkit:issues:security-alerts`: Turn the security alerts of the repository scanners into issues, with a priority from the severity, after a full preview. It says the capability is absent when the repository has no scanner.
- `/pmkit:issues:summary`: Summarize an issue or an epic from its record, comments and history.
- `/pmkit:issues:track-agents`: List the open issues assigned to agents, with the delegation record and the state of each pull request.
- `/pmkit:issues:unblock`: List what blocks a pull request from merging (checks, reviews, conflicts, open threads and policies) and the next step for each.
- `/pmkit:issues:investigate-bug`: Propose root-cause hypotheses for a bug from its issue, comments, CI logs and code, and comment the diagnosis after approval. The comment holds `file:line` references and the link and step name of the CI run, never a line of a log, and `issues comment --redact` redacts secrets from it. The code is read at the issue's branch, not the working tree.
- `/pmkit:issues:update`: Change the title, priority, estimate, labels or acceptance criteria of an issue.
- `/pmkit:issues:work`: Pick up an issue: claim it, branch, plan, implement, open the PR and move it to review.
- `/pmkit:linear:customers`: List and edit Linear customers (tier, revenue, size, status) and link customer requests to issues and projects.
- `/pmkit:linear:triage-rotation`: See who is on triage duty in Linear, change the rotation, and read Linear's Triage Intelligence suggestions.
- `/pmkit:local:doctor`: Check the tracker files, fix what can be fixed and resolve git conflict markers.
- `/pmkit:local:render`: Render a board, roadmap or sprint view of the tracker as Markdown or HTML for people outside the agent.
- `/pmkit:local:migrate`: Move the Local tracker to a Linear team, import a Linear team into .issues/, undo an export, or switch pmkit to the new tracker.
- `/pmkit:report:initiatives-and-goals`: Show the progress of each strategic goal through its epics, or of the top-level issues when there are no goals.
- `/pmkit:report:release-notes`: Write release notes for a release, a sprint or a period, and save them after you confirm.
- `/pmkit:report:roadmap-review`: Epics and milestones with dates, health and delays, and the epics with no recent status update, in one read-only report.
- `/pmkit:report:release-readiness`: What is left for a release: open issues, open pull requests and deploys. Without releases it uses a milestone or a sprint and says so.
- `/pmkit:report:status`: Draft a status update for an epic and publish it after approval.
- `/pmkit:spec:import`: Turn a spec or PRD into an epic with milestones, issues, sub-issues, estimates and blockers.
- `/pmkit:spec:record-decision`: Write an ADR from a decision after you confirm it, and link it to the issues it affects with a comment on each. The file is `docs/adr/NNNN-title.md` when the repository has that folder or the tracker cannot create documents, and the tracker folder (`.issues/docs/adr/` by default) otherwise.
- `/pmkit:team:capacity`: Capacity and days off per member for a sprint, with the effect on the load, changed after a preview.
- `/pmkit:team:flow-metrics`: Show cycle time, lead time, throughput, aging and bug rate for a period, with the trend against the previous period.
- `/pmkit:team:load`: Issues, estimates and work in progress per member, with imbalances and members with no work, and reassigns after a full preview.
- `/pmkit:team:risk-radar`: Blockers, stalled issues and PRs, late epics, epics without a recent status update and broken CI, in one read-only report.
- `/pmkit:team:standup`: Digest of what changed since the last business day, per person, with what needs attention.

## CLI

Run `node scripts/pmkit.mjs <command>`. Every command takes `--json` and `--root <dir>`. Every write also takes `--dry-run` and `--as <member>`.

With `auto_commit: true` in `.issues/config.yaml`, each write commits the files it changed as `pmkit: <command> <id>`. With `auto_commit: false`, the default, no command commits. `--dry-run`, `init`, `pr open` and `pr ready` never commit.

| Command | Does |
|---|---|
| `init` | writes `.pmkit/config.yaml` and scaffolds `.issues/`; refuses to overwrite. Flags: `--tracker local\|linear`, `--git-host github\|none`, `--workspace`, `--team`, `--status key=name`, `--field key=value`, `--type-label type=label`, `--prefix`, `--id-style random\|numbered`, `--estimate-unit points\|hours\|sizes`, `--label name`, `--member id --name n --email e`, `--members-file f\|-` |
| `init --tracker linear` | reads the Linear workspace with the key in `LINEAR_API_KEY`, applies what it can infer, lists what it must ask and writes only `.pmkit/config.yaml`. `--dry-run` returns `applied`, `questions` and `broken`; the answers go back as `--team`, `--status`, `--field` and `--type-label` |
| `link-repo [--git-host github\|none] [--repo owner/name] [--default-branch name] [--remote name] [--team KEY]` | sets `git_host.system`, `git_host.repo`, `git_host.default_branch` and, on Linear, `tracker.scope.team` in `.pmkit/config.yaml`, keeping its comments and order. Without flags it infers the host, repo and default branch from `origin` (or the only remote) with no network call, and a host it does not recognize as GitHub changes nothing. Only `--git-host none` lowers a host, and it also removes `git_host.repo` and `git_host.default_branch`. `--team` is the only Linear call and is checked against the workspace and refused when it breaks the mappings. `--dry-run` shows the diff |
| `init --update` | edits only the lines its flags name and adds or updates the schema line in the config files; `--replace <path>` overwrites a template file that differs |
| `capabilities` | prints the capability manifest |
| `discover` | prints statuses with categories, types, priorities, labels, members and the estimate scale |
| `whoami` | prints the resolved actor |
| `default-branch` | prints `git_host.default_branch` as `branch`, with `configured`, `valid` and `note`. An unset or invalid name (anything git or a shell could misread, such as `main; curl x\|sh`) gives `main`, and an invalid one a `note:`. Command files take the base branch from here, never from the config. `validate` reports an invalid name. Reads only `.pmkit/config.yaml`, so it works with no tracker or a broken one: a missing or unreadable file gives `main` with a note |
| `issues list` | searches issues by text, category, type, assignee, label, sprint, parent, blocked state or date, oldest created first unless `--sort` says otherwise |
| `issues get <id>` | shows one issue, with `--comments` and `--history` |
| `issues dependencies <id>` | shows the blocker chain, the hierarchy and the critical path of an issue or an epic; only reads |
| `issues create` | creates an issue; takes `--milestone` and `--release` |
| `issues update <id>` | edits fields and acceptance criteria; `--milestone`, `--release` and `--branch` take `none` to clear |
| `issues move <id> <category>` | changes status by category |
| `issues assign <id> <member\|me\|none>` | assigns an issue; `me` is the actor |
| `issues delegate <id> <agent:name>` | hands an issue to an agent with a delegation comment: on Local the agent becomes the assignee and runs locally, on Linear (`agent:<Linear user id>`) it becomes the delegate and Linear runs it; `--instructions-file` holds the instructions |
| `issues track-agents` | open issues assigned to agent members, with the delegation record and the state of each pull request; reads only |
| `issues link <from> <to> --kind blocks\|related\|duplicate` | links or unlinks (`--remove`) two issues |
| `issues parent <id> <parent\|none>` | sets the parent |
| `issues comment <id> --body-file f [--reply-to c] [--redact]` | adds a comment; `--redact` replaces the secrets in the body by `[redacted]` first |
| `issues log-time <id> <time>` | logs time; `<time>` is minutes (`90`, `45m`) or hours (`2h`, `1h30`, `1.5h`), from 1 minute up to the largest safe integer number of minutes, above which it answers `INVALID_INPUT` (an entry above 24 hours prints a `note:`, and a long entry reads with days, such as `1d1h`); the capability is checked before the time, so a tracker with no time tracking refuses first |
| `issues parse-time <time>` | reads a time as minutes, with `note` set above 24 hours; needs no tracker and writes nothing |
| `text redact --file f` | replaces secrets by `[redacted]` and returns `text`, `count`, `counts` and `summary`; the types in `counts` are `private_key`, `url_credentials`, `authorization`, `jwt`, `github_token`, `gitlab_token`, `slack_token`, `ai_api_key`, `stripe_key`, `google_api_key`, `npm_token`, `aws_key`, `bearer`, `curl_user` and `api_key_value` (every value after a secret key, so it trades false positives for no missed secrets); needs no tracker and writes nothing |
| `issues time-entries <id>` | lists the time logged on an issue, with the total |
| `issues archive <id>` | archives an issue |
| `issues delete <id>` | deletes an issue for good, and refuses while another issue lists it as blocked by, related, duplicate of or parent. `--dry-run` is the full preview. Archive keeps the record and its history, delete does not |
| `issues bulk <change> <value> (filter flags \| --view name) [--max n] [--expect digest]` | applies one change (`move`, `assign`, `priority`, `estimate`, `label-add`, `label-remove`, `milestone`, `release`, `sprint`, `parent`, `link`) to every matched issue through the one-by-one operations. `--dry-run` is the full preview with a digest, and the real run needs it as `--expect` |
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
| `epic goal <id> <goal\|none>` | links an epic to a goal, or removes the link with `none` (an empty goal is refused) |
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
| `release-readiness [--release id \| --milestone id \| --sprint id\|current]` | what is left for a release: open issues, open pull requests and deploys; without releases a milestone or a sprint, and says so; only reads |
| `release-notes [--release id \| --sprint id\|current \| --since d [--until d]]` | the done issues of a release, a sprint or a period, grouped by type, with the basis it used; only reads |
| `docs list` | lists the documents under the docs folder (Local) or the documents of the team's projects (Linear) |
| `docs read <path>` | prints a document under the docs folder |
| `docs create <path> --body-file f` | creates a document under the docs folder |
| `docs next-adr --title t` | the number, slug and path of the next ADR and where it goes, `repo` (`docs/adr/`) or `tracker`; reads `docs/adr/` and the tracker folder in the working tree and in `origin/<default branch>`, refuses a title with no letter or digit; only reads |
| `views save <name> [filter flags] [--overwrite]` | saves an issue filter as `.issues/views/<name>.yaml`; takes the flags of `issues list`, and refuses a name that exists unless `--overwrite` |
| `views list` | lists the saved views with their filters |
| `goal list` | lists the goals in `.issues/goals/` with the epics linked to each |
| `goal get <id>` | shows one goal and its epics |
| `goal create --title t [--target YYYY-MM-DD]` | creates a goal as `.issues/goals/<ID>.md`; the ID is `GOAL-` and a code that follows `id_style` |
| `goal progress <id>` | adds up the progress of the epics linked to a goal, as `epic progress` counts each one |
| `customers list` | lists the customers in `.issues/customers/`, highest revenue first, with the keys `linear customers list` prints |
| `customers show <id or name>` | shows one customer and its requests, newest first |
| `customers create --name n [--status s] [--tier t] [--revenue n] [--size n] [--owner member]` | creates a customer as `.issues/customers/<ID>.md`; the ID is `CUS-` and a code that follows `id_style` |
| `requests list [--state open\|accepted\|declined\|all] [--customer id]` | lists the requests, the open ones (the inbox) by default, oldest first |
| `requests get <id>` | shows one request, with a warning for a customer or issue that cannot be read |
| `requests create --title t [--customer id] [--from text] [--important] [--issue id] [--body-file f]` | records a request as `.issues/requests/<ID>.md`, open, or accepted into an issue with `--issue`; the ID is `REQ-` and a code that follows `id_style` |
| `requests accept <id> <issue>` | accepts a request into an existing issue; to turn it into a new issue, run `issues create` first |
| `requests decline <id> [--reason text]` | declines a request |
| `demand list` | groups the accepted requests by issue, most requests first, with the customers who asked |
| `inbox list [--as member] [--since ts] [--all] [--reviews [--login l ...]]` | lists the assignments, `@member` mentions and status changes (a move of an issue assigned to the member, by someone else) the member has not seen, oldest first, each with a `key`; the first list shows the last 14 days and `hidden` counts the older ones, one item for each line that mentions the member; the table shows the mention text and whether the item was seen; `complete` is `false` when a file could not be read; `--reviews` adds the open pull requests that request the member's review (matched by member id or `--login`, from one `gh pr list` call; on Linear only by `--login`) in `reviews`, "not verified" when GitHub cannot be read or, on Linear, without `--login`. On Local the seen set is shared by every worktree of the repository (keyed by its git remote, joining the seen keys of each worktree's older per-checkout file once); on Linear the list is the key owner's Linear notifications |
| `inbox mark-read [--as member] [--key key ...] [--dry-run]` | records the items as seen in the user store, never in `.issues/`; to mark what you listed, pass the `key` of each item with `--key`, because with no `--key` it marks everything unseen at that moment, including an item that arrived after the list (and, the first time, the items older than 14 days that the list counted); a key no item has is reported in `unknown` and the others are marked; refuses while the inbox is incomplete; two runs at once keep each other's keys (the user store file is locked on write); on Linear it sets the notifications' read time and, when a write fails, stops and names the keys left |
| `views run <name>` | runs a saved view and lists its issues; `sprint: current` and `assignee: me` stay symbolic, so they resolve when the view runs |
| `metrics velocity` | points or counts done per closed sprint, and the average |
| `metrics cycle-time` | median and p85 days from first `in_progress` to `done` |
| `metrics lead-time` | median and p85 days from creation to `done` |
| `metrics throughput` | issues done in a range, with a count per type |
| `metrics aging` | days since work started for each issue in `in_progress` or `in_review` at `--until` (default now), oldest first |
| `events` | prints all events in a range, for digests |
| `risks` | blockers, stalled issues and PRs, late epics, epics without a recent status update and broken CI; reads only. With `git_host.system: none`, or when `gh` is missing or logged out, it lists issues stalled by tracker activity and marks pull requests and CI as not checked |
| `roadmap review` | epics and milestones with dates, health (from the newest status update, else the tracker; never from progress) and days late, and the epics with no recent status update; an epic whose updates could not be read is listed as not checked, never as stale; a cut or failed read marks the review incomplete; without epics it lists the late open issues; only reads |
| `team load [--sprint current\|id]` | issues, estimates (points or hours) and work in progress per member for the active sprint, or for all open work when no sprint is active, with imbalances (above 1.5 times the average, over sprint capacity, open work with availability 0), members with no work and a proposal of moves; counts issues when estimates are off, absent or t-shirt sizes; a member whose open issues have no estimate has an unknown load, and one with some unestimated issues has a partial load, and neither is a move target; only reads |
| `team capacity [--sprint current\|id] [--set member=n\|none,..] [--days-off member=date+date\|none,..]` | capacity and days off per member for a sprint; `--set` merges and `none` removes, a write is one call and takes `--dry-run`. Agents and, on Linear, members outside the team are refused. On Linear it writes only `.pmkit/capacity.yaml` |
| `alerts list [--severity s,..] [--report scanner=file ..]` | security alerts from the scanners the repository has, highest severity first: `npm audit` (`package-lock.json` or `npm-shrinkwrap.json`), `yarn audit` (Yarn classic, `yarn.lock`), `pnpm audit` (`pnpm-lock.yaml`), `pip-audit` (`requirements.txt`) and `cargo audit` (`Cargo.lock`). One alert per package. Severity is `critical`, `high`, `medium`, `low` or `unknown`: pip-audit gives none, and cargo takes it from the CVSS 3 score of the advisory. `--report <scanner>=<file>` (repeatable) reads the saved `--json` output of a scanner instead of running it, so the command works offline; with it, nothing runs and a detected scanner without a report is `skipped` with a warning. A scanner that fails or does not audit every package is a warning, `incomplete` is `true`, and the text output says the result is incomplete; reads only |
| `alerts scan [--severity s,..] [--report scanner=file ..]` | the alerts of `alerts list` that no issue holds yet, each with a type, a priority (by name first, then by position in the tracker priorities, never `none`, and `null` for an `unknown` severity) and a description that ends with its `alert-key:` line (the scanner and the package). A package that already has an issue is `matched`, with its current `advisories`. `absent` is `true` when no scanner is in the repository, and `incomplete` is `true` when a scanner failed or did not audit every package, or the tracker read was cut, in which case no issue should be created; reads only |
| `issues branch <id> [--from branch]` | creates the issue branch from `--from` (default: `git_host.default_branch`) and records it on the issue |
| `pr open --issue <id> [--draft] [--body-file f]` | pushes the issue branch and opens a pull request; when the branch already has an open one, pushes and returns it with `existing: true` |
| `pr ready --issue <id>` | marks the open draft pull request of an issue ready for review |
| `pr status [--branch b]` | the pull request, checks and reviews of a branch (default: the current branch); a failing check that is a workflow run shows its `ci logs --run <id>`. For an open pull request, `blockers` holds the verdict of `pr blockers` (`blocked`, `blocking`, `pending`, `unknown`, `unchecked`), and the text has a `blockers:` line; it is `null` without a pull request. A blocker read that fails with `RATE_LIMITED` or `UPSTREAM` keeps the pull request and its checks: `blocked` is `null` and `unchecked` has one entry with the area `blockers` and the error's `code`, and the reads after it are not made |
| `todos scan [--path folder-or-file]` | TODO and FIXME comments in the files the repository lists (tracked, and untracked but not ignored), grouped by text. A tag counts only as the first word of a comment in a known language, and Markdown only inside `<!-- -->`. It skips `node_modules`, the tracker folder, symbolic links, binaries and files over 1 MiB, and drops the comments an issue matches by its `todo-key:` line or by the comment text as whole words. `--path` takes one folder (with everything under it) or one file inside the repository, relative to the repository root; a path that is outside it or does not exist answers `INVALID_INPUT`. Block comments are read in the C-like languages, SQL (`/* */`), Lua (`--[[ ]]`) and Haskell (`{- -}`). A skipped-type count (`skipped.unsupported`) and a warning list the files it did not read. `incomplete` in the JSON says the tracker read is not complete, either `cut` (the tracker has more issues than the CLI read) or `unread` (`{ count, ids }`: issues whose files could not be read), so a comment an issue covers may look new and nothing should be created from the list; reads only |
| `pr blockers [--branch b]` | what blocks the pull request of a branch: failing and pending checks, changes requested and requested reviewers (users in `reviews.requested`, teams in `reviews.requestedTeams`), merge conflicts, open review threads (every page) and unmet rules of the classic branch protection and of the active repository rulesets (`rules/branches`), merged. A read GitHub refuses, such as branch protection without admin rights, is listed in `unchecked` and named in `policies.unread`; a rule that the other source requires still blocks |
| `pr diff [--branch b] [--base b] [--max-lines n]` | the diff of the open or merged pull request of a branch (default: the current branch). Without one, or when GitHub refuses a diff that is too large, the local diff against `origin/<base>` (default `git_host.default_branch`), with the uncommitted changes of tracked files for the checked out branch (against the base of the pull request when it has one, or `--base`). A merged pull request whose head is not on the branch (a reused name) is not used. A `note:` says which case applied, and says when uncommitted changes or untracked files are not in the diff. `incomplete` in the JSON marks a merged pull request whose diff is not available. Keeps the first `--max-lines` lines (default 2000); reads only |
| `pr sync` | moves `in_review` issues to `done` when their pull request is merged |
| `deploys list [--environment e] [--limit n]` | the repository deployments (default 20, at most 100) with the state of the latest status of each, read in one call (a status that cannot be read shows `unknown`, not `pending`); reads only |
| `ci logs [--branch b] [--run id] [--tail n]` | the log of the failed steps of a workflow run: `--run`, or the newest failed run of a branch (default: the current branch); keeps the last `--tail` lines (default 200); the result has the workflow name, URL, conclusion, `createdAt` and `headSha`, `supersededNote` (a newer run of the workflow succeeded) and `logNote` says when the run did not fail, has not finished, was a `startup_failure` or has no log; reads only |
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
