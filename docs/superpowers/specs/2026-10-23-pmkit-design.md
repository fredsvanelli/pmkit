# pmkit: Project Management Kit for Agents

Decisions from the planning sessions of 2026-10-23, recorded in the planning doc "pmkit - Project Management Kit for Agents" (tabs Unified model, MVP skills, Local adapter, Technical spec). Terms are defined in `pmkit/CONTEXT.md`, which Task 20 of the core plan writes. Calls marked **(builder's call)** were made by Claude while writing this spec and the user has not confirmed them. Everything else the user decided.

## Why

Development agents (Claude Code, Codex, OpenCode) write the code, but the work around the code lives in a tracker: which issue to pick up, what blocks it, what the sprint holds, how the epic is going. Today the agent either ignores the tracker or calls a vendor MCP with its own shapes, and every team's workflow is described again in every session.

pmkit gives the agent one set of commands for project work, written in the language of a dev, a PM or an EM, that run the same way whatever tracker the team uses. The plugin translates. The first tracker is a local one: issues kept as files inside the repository, under `.issues/`, so the whole kit works with no account, no network and no setup beyond one command.

## Goals

- One command set for devs, PMs and EMs, the same across trackers.
- A Local tracker that keeps issues, sprints, epics and history as plain files in the repository, versioned and shared through git.
- A GitHub git host, so a dev takes an issue from the tracker to an open PR without leaving the agent.
- A contract every tracker adapter implements, so Linear, Jira, GitHub Issues, GitLab and Azure DevOps plug in later without touching the commands.
- A capability manifest per instance, so commands degrade instead of failing when a tracker lacks a feature.

## Non-goals

- No hosted tracker adapter in the MVP. Linear comes right after; Jira, GitHub Issues, GitLab and Azure DevOps later.
- No proactive mode in the MVP. Scheduled headless runs come in phase 2; webhooks only if a hosted product exists.
- No Bitbucket in the MVP. Its git host adapter ships with the Jira adapter.
- No web UI. `local-render` (a static board) is a phase 2 command.
- No MCP server in the first build step. Claude Code commands call the CLI; the MCP server is step 2 and exists for Codex and OpenCode.

## Anti-goals

- The plugin never changes a tracker's configuration: statuses, workflows, fields, permissions. It reads them.
- The plugin never stores a credential in the repository. GitHub access goes through the `gh` login.
- The plugin never commits on its own unless `auto_commit` is on. Tracker changes show up as file edits for the user to review and commit, ideally together with the code they belong to.
- A command never guesses a mapping it cannot infer for sure. It asks, and stores the answer.

## Constraints

- A plugin folder `pmkit/` in `fredsvanelli/skills`, next to `runbooks` and `utils`, installed on its own from the marketplace.
- Node 18+ ES modules, no dependencies, like `runbooks/scripts/`. Tests with `node:test`. No Node 20 APIs.
- Commands are Markdown procedures in `commands/**`, user-invoked (`disable-model-invocation: true`), each with a `## Parameters` section, like `runbooks`. Subfolders give three-level names: `commands/issues/create.md` is `/pmkit:issues:create`, as `/runbooks:roles:create` already proves. One routing skill, `skills/pmkit/SKILL.md`, maps natural-language requests to the command files.
- Commands call `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" <command>` for every computation and every write. They never edit `.issues/` files by hand.
- Every YAML file pmkit reads or writes fits the YAML subset of `runbooks/scripts/lib/yaml.mjs`: block maps, block lists of scalars, flow lists, flow maps, quoted and plain scalars, comments. No list of maps anywhere **(builder's call)**: members, statuses and capacity are maps keyed by id. pmkit keeps its own copy of the parser, because plugins install independently.
- Files may have CRLF line endings (the repository lives on Windows). Every reader normalizes `\r\n` to `\n`; every writer writes `\n`.
- Section headings, frontmatter keys, file names and keywords that scripts parse stay in English.

## Architecture

Four layers. Only the third knows a specific system.

1. **Commands and the routing skill.** Markdown. They describe the dev, PM or EM workflow in terms of the common model, ask the user at the confirmation points, and call the CLI.
2. **Common model and contract.** `scripts/lib/model.mjs`, `scripts/lib/contract.mjs`: entities, status categories, field roles, typed errors, and the operations every tracker and git host implements.
3. **Adapters.** `scripts/lib/local/` (Local tracker) and `scripts/lib/github/` (GitHub git host, through `gh`). Each tracker adapter also builds the capability manifest of its instance.
4. **Local context.** `.pmkit/config.yaml` in the repository (committed, shared) and a user store under `~/.config/pmkit/` (cache, manifest, never committed).

The CLI (`scripts/pmkit.mjs`) is the only entry point the commands use. It loads the config, picks the adapters, runs one operation and prints the result as a table or, with `--json`, as JSON.

## Common model

Seven status categories: `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`. Commands reason by category only. Every adapter maps its statuses to these. Blocked is not a category: an issue is blocked when one of its `blocked_by` issues is not `done` or `canceled`.

Entities in the MVP:

| Entity | Fields |
|---|---|
| Issue | `id`, `title`, `type`, `status` (`{ name, category }`), `priority`, `estimate`, `assignee`, `labels`, `parent`, `blockedBy`, `blocks` (computed), `related`, `duplicateOf`, `children` (computed), `archived`, `sprint`, `milestone`, `release`, `due`, `branch`, `description`, `acceptanceCriteria` (`[{ text, done }]`), `created`, `updated` |
| Comment | `id`, `issue`, `author`, `body`, `created`, and two optional thread keys: `parent` (the root comment, on a reply only) and `resolved` (`{ at, by }`, on a resolved root only) |
| Event | `at`, `by`, `op`, `field`, `from`, `to`, `minutes`, `synthetic` |
| Sprint | `id`, `name`, `start`, `end`, `goal`, `state` (`planned`, `active`, `closed`), `closed` (optional, ISO timestamp of the close with `Z` or an offset, set by `closeCycle`), `capacity` (member id → points or hours), `daysOff` (member id → dates) |
| Epic | `id`, `title`, `status`, `start`, `target`, `milestone`, `goal`, `description` |
| Goal | `id`, `title`, `target`, `description`, `epics` (computed from the epics whose `goal` names it) |
| Milestone | `id`, `name`, `due`, `description` |
| Release | `id`, `name`, `tag`, `target`, `released`, `state` (`planned`, `released`; computed from `released`), `description` |
| Status update | `epic`, `at`, `author`, `health` (`on_track`, `at_risk`, `off_track`), `body` |
| Member | `id`, `name`, `email`, `availability` (0 to 1) |

Event ops: `create`, `update`, `move`, `assign`, `link`, `unlink`, `comment`, `log_time`, `archive`.

## Capability manifest

The 20 capabilities of the Unified model (`cycles`, `estimation`, `multilevel_hierarchy`, `dependencies`, `native_triage`, `deliverables`, `strategic_goals`, `status_update`, `releases`, `capacity`, `native_metrics`, `saved_views`, `documents`, `demand_signals`, `request_queue`, `time_tracking`, `linked_code`, `agent_delegation`, `security_alerts`, `user_inbox`). Each has a path (`native`, `derived`, `conditional`, `absent`), an optional `detail` map and an optional `enableHint`.

The Local tracker serves 14 of the 20: 11 native and 3 derived (`native_metrics`, `linked_code`, `security_alerts`). It reports the other six as `absent`, each with an `enableHint`. The served-by table and the full split are in `2026-10-25-pmk-2-capability-manifest-design.md`. In the MVP the manifest is computed on each run from the config **(builder's call)**: it is cheap for the Local tracker, and caching starts with the first hosted adapter.

`pmkit capabilities [--json]` prints it. `/pmkit:help` reads it.

## Contract

The operations the MVP needs, grouped by family. Every write takes an `actor` (a member id) so the event log records who did it, and accepts `{ dryRun: true }`, which validates and returns the change without writing. Every write returns `{ before, after }` for the record it changed **(builder's call)**, so commands can show before → after in confirmations from the dry run.

| Family | Operations |
|---|---|
| Discovery | `discover()` → statuses, types, priorities, labels, members, estimate scale; `capabilities()` |
| Issues | `searchIssues(filter)`, `getIssue(id)`, `createIssue(input, actor)`, `updateIssue(id, patch, actor)`, `moveToCategory(id, category, actor, { status })`, `assign(id, member, actor)`, `archive(id, actor)` |
| Relations | `link(from, to, kind, actor)`, `unlink(from, to, kind, actor)` with kind `blocks`, `related` or `duplicate`; `setParent(id, parent, actor)` |
| History and comments | `getHistory(id, { since })`, `listComments(id)`, `comment(id, body, actor, { replyTo })`, `resolveThread(id, commentId, actor)` |
| Cycles | `listCycles({ state })`, `currentCycle()`, `cycleIssues(id)`, `openCycle(input, actor)`, `closeCycle(id, actor)`, `moveToCycle(ids, sprint, actor)` |
| Deliverables | `listDeliverables()`, `getDeliverable(id)`, `deliverableProgress(id)`, `createDeliverable(input, actor)`, `publishStatusUpdate(update, actor)`, `listStatusUpdates(epic)` |
| Milestones | `listMilestones()`, `getMilestone(id)`, `createMilestone(input, actor)` |
| Goals | `listGoals()`, `getGoal(id)`, `createGoal(input, actor)`, `goalProgress(id)`, `setEpicGoal(epic, goal, actor)` |
| Releases | `listReleases({ state })`, `getRelease(id)`, `releaseIssues(id, { archived })`, `createRelease(input, actor)`, `markReleased(id, actor, { tag })` |
| Capacity | `getCapacity(sprint)`, `setCapacity(sprint, capacity, actor)` |
| Metrics | `metricEvents({ since, until })` |
| Documents | `readDocument(path)`, `createDocument(path, body, actor)` |
| Time | `logTime(id, minutes, actor)` |

Natural-language queries are translated by the command, not by the contract **(builder's call)**. `/pmkit:issues:find` turns the question into CLI filter flags, shows the flags in one line, and runs them. The contract's `searchIssues` takes a structured filter: `text`, `categories`, `types`, `assignee` (member id, `me` or `none`), `labels`, `sprint` (id, `current` or `none`), `parent`, `blocked`, `updatedBefore`, `updatedAfter`, `sort` (`priority`, `updated`, `created`, `due`; `created` by default, oldest first), `limit`. Every issue table a command shows uses creation order, oldest first, unless the user asks for another order. The same order picks the next issue in `/pmkit:issues:work` and `/pmkit:issues:mine`, and the sprint scope in `/pmkit:cycle:plan`.

Git host operations: `currentBranch()`, `createBranch(name, { from })`, `push(branch)`, `openPullRequest({ title, body, head, base, draft })`, `getPullRequest({ number | head })`, `markReady(number)`, `prChecks(number)`, `prReviews(number)`.

### Errors

`PmkitError` with a stable `code` and a `nextStep`. Codes: `NOT_CONFIGURED`, `NOT_FOUND`, `NOT_SUPPORTED`, `INVALID_INPUT`, `CONFLICT`, `AUTH`, `RATE_LIMITED`, `UPSTREAM`. The CLI prints `error: <message>` and `next: <next step>` on stderr and exits 2; with `--json` it prints `{ "error": { "code", "message", "nextStep" } }` on stdout and still exits 2.

## Config

### `.pmkit/config.yaml`

Committed. One per repository. Holds no secret.

```yaml
version: 1
tracker:
  system: local                  # local | linear | jira | github | gitlab | azure-devops
  path: .issues                  # local only
  scope: { workspace: acme }   # hosted trackers only, such as team: ENG
git_host:
  system: github                 # github | none in the MVP
  repo: fredsvanelli/my-app      # inferred from the git remote by setup
  default_branch: main
write_policy:
  confirm: single_writes         # all_writes | single_writes | none
  preview: [bulk, delete, publish_update, move_scope]
mappings:                        # hosted trackers only: status and field names of the tracker
```

Hosted trackers add `tracker.scope` and a `mappings` map. The loader rejects a known `tracker.system` that has no adapter with `NOT_SUPPORTED`, and an unknown one with `INVALID_INPUT`. With any other problem in the file, reads go on with a warning and writes refuse.

### `.issues/config.yaml`

Committed. Exists only with `tracker.system: local`. Defines the Local tracker.

```yaml
version: 1
id_prefix: ISS
epic_prefix: EPC
statuses:
  triage: { category: triage }
  backlog: { category: backlog }
  todo: { category: todo }
  in_progress: { category: in_progress }
  in_review: { category: in_review }
  done: { category: done }
  canceled: { category: canceled }
default_status: backlog
types: [feature, bug, task, chore]
priorities: [urgent, high, medium, low]
labels: []
estimate:
  unit: points                   # points | hours | sizes
  scale: [1, 2, 3, 5, 8, 13]
members:
  fred: { name: Fred Vanelli, email: fredsvanelli@example.com, availability: 1 }
defaults:
  stale_days: 60
  stuck_business_days: 3
  sprint_length_days: 14
  sprint_start_weekday: mon
  velocity_window: 3
  status_update_window_days: 14
auto_commit: false
```

Rules: every status maps to exactly one category, and every category has at least one status **(builder's call)**, so `moveToCategory` always has a target. When a category has several statuses, `moveToCategory` takes the first one listed unless `{ status }` names another. `id_prefix` and `epic_prefix` are 2 to 5 capital letters and differ. Member ids are kebab-case or `agent:<name>`.

### User store

`~/.config/pmkit/` (or `$XDG_CONFIG_HOME/pmkit/`, `%APPDATA%\pmkit\` on Windows) **(builder's call)**. In the MVP it holds only `inbox/<repo-hash>.json`, the time of the user's last inbox check. Nothing in it is required for a command to work.

### Actor

The current user is the member whose `email` equals `git config user.email`. Without a match, `PMKIT_USER` names the member id. Without either, writes fail with `NOT_CONFIGURED` and the next step `/pmkit:setup` **(builder's call)**. Reads never need an actor.

## Local tracker

### Layout

```text
.issues/
├── config.yaml
├── .gitattributes             # events.jsonl merge=union
├── .gitignore                 # .cache/
├── issues/
│   └── ISS-7K3Q/
│       ├── issue.md
│       ├── events.jsonl
│       └── comments/2026-10-23T21-12-00Z-fred.md
├── epics/
│   └── EPC-2M9D/
│       ├── epic.md
│       ├── events.jsonl
│       └── updates/2026-10-23-fred.md
├── sprints/2026-11-02.yaml
├── milestones/
├── releases/
├── docs/
└── .cache/                    # phase 2: query index
```

### Issue file

`issues/<ID>/issue.md`: YAML frontmatter, then a Markdown body with two sections, `## Description` and `## Acceptance criteria`. Acceptance criteria are a task list (`- [ ]`, `- [x]`). Any other section the user adds stays where it is **(builder's call)**.

```markdown
---
id: ISS-7K3Q
title: Retry failed webhook deliveries
type: bug
status: in_progress
priority: high
estimate: 3
assignee: fred
labels: [backend, webhooks]
parent: EPC-2M9D
blocked_by: [ISS-4P8A]
sprint: 2026-11-02
due: 2026-11-14
branch: iss-7k3q-retry-webhooks
created: 2026-10-23T21:12:00Z
updated: 2026-10-24T13:40:00Z
---

## Description

Deliveries that fail with 5xx are dropped instead of retried.

## Acceptance criteria

- [ ] Retries with exponential backoff, max 5 attempts
- [ ] Dead-letter after the last attempt
```

When set, `milestone` and `release` sit after `sprint` and before `due`.

Writes rewrite the frontmatter in a fixed key order and drop keys that are empty or absent **(builder's call)**. YAML comments inside an issue's frontmatter are not preserved; comments in config files are, because the adapter never rewrites config files (only `setup` writes them, once).

Archived issues keep their folder and get `archived: true`. Searches skip them unless `--archived` is passed.

### Event log

`issues/<ID>/events.jsonl`, one JSON object per line, append-only. `.issues/.gitattributes` marks it `merge=union`, so two branches that append to the same issue merge without a conflict. Readers sort events by `at`, drop exact duplicate lines and skip lines that do not parse, reporting them as problems for `local-doctor` **(builder's call)**.

**Drift.** When someone edits `issue.md` by hand, the frontmatter no longer matches the state the events lead to. Before every write to an issue, the adapter replays its events, compares the result with the frontmatter, and appends a `synthetic: true` event for each field that differs, dated with the file's modification time **(builder's call)**. Metrics stay correct, and the next write starts from the file as the user left it.

### Comments

One file per comment, `comments/<timestamp>-<author>.md`, with frontmatter `author` and `created`. The timestamp uses `-` instead of `:` so the name is valid on Windows. Two people commenting at once never touch the same file.

A reply adds `reply_to: <root comment id>` to its frontmatter. A reply to a reply takes the root, so threads are one level deep. Resolving a thread adds `resolved: <timestamp>` and `resolved_by: <member>` to the root's file and logs a `comment` event with field `resolved`. The three keys are optional, so a comment file without them reads as before and the tracker format stays 2.

### IDs

`<prefix>-<code>`, where the code is 4 characters of Crockford base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I, L, O or U) from `crypto.randomInt`. The adapter retries on a collision with an existing folder and, after 5 collisions, uses 5 characters **(builder's call)**. IDs are case-insensitive on input and stored upper-case. Branch names use the lower-case ID: `iss-7k3q-<slug of the title, at most 40 characters>`.

### Sprints

`sprints/<start date>.yaml`. The file name is the sprint id. At most one sprint is `active`. `currentCycle()` returns the active sprint, or null. `openCycle` refuses a sprint that overlaps another planned or active one, and makes it `active` when its start is today or earlier and no sprint is active **(builder's call)**. `closeCycle` sets `state: closed` and `closed`, the time of the close, and returns the issues not in a terminal category. `/pmkit:cycle:close` moves or splits them before the close, so the list is empty after a full run. Velocity counts a done issue of a closed sprint when its last move to `done` is at or before `closed`, and, for a closed sprint without `closed`, when the UTC date of that move is on or before `end`.

```yaml
name: Sprint 2026-11-02
start: 2026-11-02
end: 2026-11-15
goal: Webhook retries and the billing export
state: active
capacity: { fred: 8, ana: 10 }
days_off:
  ana: [2026-11-06]
```

### Epics

`epics/<ID>/epic.md`: frontmatter `id`, `title`, `status`, `start`, `target`, `milestone`, then a Markdown description. Epic statuses use the same status names as issues. Status updates are `epics/<ID>/updates/<date>-<author>.md` with frontmatter `author`, `created`, `health`. An issue belongs to an epic through `parent`. `deliverableProgress` counts the issues whose parent chain reaches the epic: total, done, points, points done.

### Milestones

`milestones/<id>.md`: frontmatter `name` and an optional `due`, then a Markdown description. The file name is the milestone id. The id rule, the reference checks and the `milestone list`, `get` and `create` commands are in `2026-10-25-pmk-3-milestones-design.md`.

### Releases

`releases/<id>.md`: frontmatter `name`, an optional `tag`, `target` and `released`, then a Markdown description. The file name is the release id and the version. An issue joins a release through `release`. The id rule, the order, the tag check and the commands are in `2026-10-26-pmk-22-local-releases-design.md`.

### Writes and commits

Every write is: load, check drift, validate, write the file to a temp name in the same folder and rename it over the old one, append the event **(builder's call)**. With `auto_commit: true`, the CLI then runs `git add` on the changed paths and commits with the message `pmkit: <op> <id>`. Off by default.

### Merge conflicts

A frontmatter conflict from git leaves conflict markers in `issue.md`. Readers detect `<<<<<<<` and fail that one issue with `CONFLICT` and the next step `/pmkit:local:doctor`, without failing the whole search **(builder's call)**.

### Format and migrations

The `version` key of `.issues/config.yaml` is the tracker format. It goes up only when the files change shape, not with every plugin release. The CLI holds one constant, `FORMAT_VERSION`, the format it reads and writes **(builder's call)**. `.pmkit/config.yaml` has its own `version`, which migrations do not touch. A change to its shape is announced in the changelog with a `Setup:` line **(builder's call)**. The first release has `FORMAT_VERSION` 1 and no migrations.

Rules for a repository whose format differs from the CLI's:

- **Older format.** Reads work. The loader copies the tracker folder to a temporary folder, applies the pending migrations there, and reads the copy, so readers only see the current shape **(builder's call)**. Writes refuse with `NOT_SUPPORTED` and the next step `/pmkit:upgrade`.
- **Newer format.** Reads and writes refuse with `NOT_SUPPORTED` and the next step `/pmkit:upgrade`.
- **Version below 1.** The loader fails with `INVALID_INPUT`, and the message names the config file **(builder's call)**.
- The loader checks the format before the rest of `.issues/config.yaml`, so a mismatch comes alone and ahead of any other config error. `migrate` skips that check and reads the files in the format they declare.
- `validate` lists a format mismatch as one `FORMAT` problem whose message ends with `; run /pmkit:upgrade` **(builder's call)**.

`migrate [--dry-run]` applies the migrations in order until the tracker reaches `FORMAT_VERSION`. The last change of each step is the new `version`. `--dry-run` prints every file it would create, change or delete, and writes nothing. The real run follows the same plan. It refuses with `NOT_CONFIGURED` outside a git repository, because git history is the only way back, and with `CONFLICT` when `git status --porcelain` shows uncommitted changes under the tracker path **(builder's call)**. With `auto_commit` on, it commits as `pmkit: migrate tracker format <from> to <to>`. Comments in `.issues/config.yaml` survive, because a migration edits only the lines it changes.

`changelog --file f --since v` prints the sections of a `CHANGELOG.md` newer than version `v`, oldest first. It needs no config. `/pmkit:upgrade` uses it to show what changes before it updates the plugin.

## GitHub git host

Through the `gh` and `git` CLIs, like the `utils` plugin. No token handling.

| Operation | Implementation |
|---|---|
| `currentBranch` | `git branch --show-current` |
| `createBranch` | `git switch -c <name> <from>` |
| `push` | `git push -u origin <branch>` |
| `openPullRequest` | `gh pr create --title --body-file - --head --base [--draft]`, then `getPullRequest({ head })` |
| `getPullRequest` | `gh pr view <number or head> --json number,url,title,state,isDraft,headRefName,author,mergedAt` |
| `markReady` | `gh pr ready <number>`, then `getPullRequest({ number })` |
| `prChecks` | `gh pr checks <number> --json name,state,bucket` |
| `prReviews` | `gh pr view <number> --json reviews,reviewRequests` |

The tracker accepts only a name `git check-ref-format --branch` accepts in `branch`, and the git host refuses a branch, head or base that starts with `-` with `INVALID_INPUT`, so no value reaches `git` or `gh` as an option **(builder's call)**.

Merged PRs are detected by an explicit `pmkit pr sync` **(builder's call)**: for every `in_review` issue with a `branch`, it asks the git host for the PR and moves the issue to `done` when the PR is merged, with an event whose `by` is the current user and `field` is `status`. `my-tasks`, `standup-digest`, `status-report` and `cycle:close` run it first. Reads stay offline.

## CLI

`node scripts/pmkit.mjs <command> [options]`. `--json` on every command. `--dry-run` on every write. Exit 0 on success, 2 on a `PmkitError`.

| Command | Does |
|---|---|
| `init --tracker local [--git-host github\|none] [--prefix ISS] [--estimate-unit points\|hours\|sizes] [--member id --name n --email e] [--members-file f\|-]` | writes `.pmkit/config.yaml` and scaffolds `.issues/` from the templates; refuses to overwrite |
| `init --update [--replace path ...]` plus the `init` flags to change | runs setup again on a configured project: keeps the answers and the comments in both config files, edits only the lines its flags name, adds missing template files, reports `differs` for a template file the user edited and replaces it only when `--replace` names it **(builder's call)** |
| `capabilities` | prints the manifest |
| `discover` | prints statuses with categories, types, priorities, labels, members, estimate scale |
| `whoami` | prints the resolved actor |
| `issues list [--text t] [--category c,..] [--type t,..] [--assignee me\|none\|id] [--label l,..] [--sprint current\|none\|id] [--parent id] [--blocked] [--updated-before d] [--updated-after d] [--sort s] [--limit n] [--archived]` | searches |
| `issues get <id> [--comments] [--history]` | one issue |
| `issues dependencies <id>` | the blocker chain, the hierarchy and the critical path of an issue or an epic; only reads |
| `issues create --title t [--type] [--priority] [--estimate] [--assignee] [--label l,..] [--parent] [--sprint id\|current\|none] [--due] [--milestone m] [--release r] [--description-file f] [--criteria-file f]` | creates |
| `issues update <id> [--title] [--type] [--priority] [--estimate] [--label l,..] [--sprint id\|current\|none] [--due] [--milestone] [--release] [--branch] [--description-file f] [--criteria-file f] [--check n] [--uncheck n]` | edits fields and criteria |
| `issues move <id> <category> [--status name]` | changes status by category |
| `issues assign <id> <member\|none>` | assigns |
| `issues link <from> <to> --kind blocks\|related\|duplicate [--remove]` | links or unlinks; only the issue whose file changes has to exist, so a dangling reference can be removed **(builder's call)** |
| `issues parent <id> <parent\|none>` | sets the parent |
| `issues comment <id> --body-file f` | comments |
| `issues log-time <id> <minutes>` | logs time |
| `issues branch <id> [--from branch]` | creates the issue branch with the git host and records it on the issue |
| `issues archive <id>` | archives |
| `cycle list [--state s]`, `cycle current`, `cycle issues <id>` | reads sprints |
| `cycle open --start d [--end d] [--goal g] [--name n]` | opens a sprint; the end defaults from `sprint_length_days` |
| `cycle close <id>` | closes and prints the unfinished issues |
| `cycle add <id...> --to <sprint\|none>` | moves issues into or out of a sprint |
| `cycle capacity <id> [--set member=n,..]` | reads or sets capacity |
| `epic list`, `epic get <id>`, `epic progress <id>` | reads epics |
| `epic create --title t [--start d] [--target d]` | creates an epic |
| `epic update-status <id> --health h --body-file f` | publishes a status update |
| `epic updates <id>` | lists the status updates of an epic, newest first |
| `milestone list`, `milestone get <id>` | reads milestones |
| `milestone create <id> [--name n] [--due YYYY-MM-DD]` | creates a milestone |
| `release list [--state planned\|released]`, `release get <id>`, `release issues <id> [--archived]` | reads releases |
| `release create <id> [--name n] [--tag t] [--target YYYY-MM-DD]`, `release mark-released <id> [--tag t]` | creates a release, marks it released |
| `release-notes [--release id\|--sprint id\|current\|--since d [--until d]]` | the done issues of a release, a sprint or a period, grouped by type, with the basis it used; only reads |
| `docs read <path>`, `docs create <path> --body-file f` | reads or creates a document under the docs folder |
| `metrics velocity [--window n]` | points or counts done per closed sprint, and the average |
| `metrics cycle-time [--since d] [--until d]` | median and p85 days from first `in_progress` to `done` |
| `metrics lead-time [--since d] [--until d]` | median and p85 days from creation to `done` |
| `metrics throughput [--since d] [--until d]` | issues done in a range, with a count per type |
| `metrics aging [--until d]` | days since work started for each issue in `in_progress` or `in_review` at `--until` (default now), oldest first |
| `events [--since d] [--until d]` | all events in a range, for digests |
| `risks` | blockers, stalled issues and PRs, late epics, epics without a recent status update, and broken CI; reads only, and without a git host lists issues stalled by tracker activity **(builder's call)** |
| `alerts list [--severity s,..]` | security alerts from the scanners the repository has (`npm audit`), with a severity of `critical`, `high`, `medium` or `low`; reads only and never calls the tracker **(builder's call)** |
| `pr open --issue <id> [--draft] [--body-file f]` | pushes the issue branch and opens a pull request; when the branch already has an open one, pushes and returns it with `existing: true` **(builder's call)** |
| `pr ready --issue <id>` | marks the open draft pull request of an issue ready for review; `INVALID_INPUT` when there is none or it is not a draft **(builder's call)** |
| `pr status [--branch b]`, `pr sync` | git host |
| `migrate [--dry-run]` | moves the tracker files to the current format; see Format and migrations |
| `changelog --file f --since v` | prints the changelog sections newer than a version |
| `render <board\|roadmap\|sprint> [--format md\|html] [--sprint id\|current] [--out f \| --save]` | renders a board, roadmap or sprint view as Markdown or HTML; see the PMK-25 spec |
| `validate` | checks every file and reference, and lists format mismatches; the base of `local-doctor` |

Bodies come from files (`--description-file`, `--body-file`, `-` for stdin), never from long flags, so Markdown survives every shell **(builder's call)**.

## Commands

The MVP shipped 24 command files, and phase 2 adds `/pmkit:issues:dependencies`, `/pmkit:team:risk-radar`, `/pmkit:backlog:triage`, `/pmkit:local:render` and `/pmkit:report:release-notes`. Commands are user-invoked; the routing skill reads the right file when the user asks in their own words.

| Command | File | Calls |
|---|---|---|
| `/pmkit:setup` | `commands/setup.md` | `init`, `validate`, `discover`, `capabilities` |
| `/pmkit:help [capability or text]` | `commands/help.md` | `capabilities`, reads the plugin's own files |
| `/pmkit:issues:find <question>` | `commands/issues/find.md` | `discover`, `issues list` |
| `/pmkit:issues:create` | `commands/issues/create.md` | `discover`, `issues create` |
| `/pmkit:issues:update <id>` | `commands/issues/update.md` | `issues get`, `discover`, `issues update` |
| `/pmkit:issues:move <id> <category>` | `commands/issues/move.md` | `issues get`, `discover`, `issues move` |
| `/pmkit:issues:assign <id> <member>` | `commands/issues/assign.md` | `discover`, `issues assign` |
| `/pmkit:issues:comment <id>` | `commands/issues/comment.md` | `issues comment` |
| `/pmkit:issues:link <from> <to>` | `commands/issues/link.md` | `issues get`, `issues link`, `issues parent` |
| `/pmkit:issues:summary <id>` | `commands/issues/summary.md` | `epic get`, `epic updates`, `issues get`, `issues list`, `issues comment` |
| `/pmkit:issues:dependencies <id>` | `commands/issues/dependencies.md` | `issues dependencies` |
| `/pmkit:issues:work [id]` | `commands/issues/work.md` | `issues list`, `issues get`, `epic get`, `issues assign`, `issues move`, `issues branch`, `issues comment`, `pr open`, `pr ready`, `issues create`, `issues link` |
| `/pmkit:issues:mine` | `commands/issues/mine.md` | `pr sync`, `cycle current`, `issues list`, `pr status` |
| `/pmkit:issues:capture` | `commands/issues/capture.md` | `discover`, `issues list`, `issues create`, `issues link` |
| `/pmkit:issues:breakdown <id>` | `commands/issues/breakdown.md` | `issues get`, `discover`, `issues create`, `issues link` |
| `/pmkit:issues:progress [id]` | `commands/issues/progress.md` | `issues list`, `issues get`, `issues comment`, `issues update`, `issues log-time` |
| `/pmkit:issues:pause [id]` | `commands/issues/pause.md` | `issues list`, `issues get`, `issues comment`, `issues move`, `issues assign`, `pr open`, `issues update` |
| `/pmkit:spec:import <file>` | `commands/spec/import.md` | `docs read`, `discover`, `epic get`, `issues list`, `milestone list`, `epic create`, `milestone create`, `issues create`, `issues link`, `docs create` |
| `/pmkit:backlog:groom` | `commands/backlog/groom.md` | `issues list`, `events`, `validate`, `issues update`, `issues parent`, `issues move`, `issues link` |
| `/pmkit:report:status <epic>` | `commands/report/status.md` | `epic list`, `pr sync`, `epic get`, `epic progress`, `issues list`, `epic updates`, `events`, `epic update-status` |
| `/pmkit:report:release-notes [release\|sprint\|period]` | `commands/report/release-notes.md` | `pr sync`, `release-notes`, `capabilities`, `docs create` |
| `/pmkit:cycle:plan` | `commands/cycle/plan.md` | `cycle list`, `discover`, `metrics velocity`, `issues list`, `cycle open`, `cycle capacity`, `cycle add` |
| `/pmkit:cycle:close` | `commands/cycle/close.md` | `pr sync`, `cycle current`, `cycle issues`, `events`, `metrics cycle-time`, `cycle list`, `cycle add`, `issues create`, `issues update`, `cycle close`, `docs create` |
| `/pmkit:team:standup` | `commands/team/standup.md` | `pr sync`, `events`, `issues list`, `pr status` |
| `/pmkit:team:risk-radar` | `commands/team/risk-radar.md` | `risks` |
| `/pmkit:local:doctor` | `commands/local/doctor.md` | `validate`, `issues get`, `migrate`, `issues update`, `discover`, `issues parent`, `issues link`, `cycle add`, `milestone create`, `release create` |
| `/pmkit:local:render [view] [format]` | `commands/local/render.md` | `render` |
| `/pmkit:upgrade` | `commands/upgrade.md` | `changelog`, `migrate` |

`/pmkit:setup` runs safely more than once. On a configured project it uses `init --update`: it shows the diff of every file it would change and writes only after the user approves, as `/runbooks:setup` does. `/pmkit:local:doctor` edits a file by hand only to remove git conflict markers, one file at a time, after the user approves **(builder's call)**. `/pmkit:upgrade` updates the plugin install, shows the changelog sections since the installed version, and runs `migrate` after approval.

The flow, inputs, confirmation points, output and edge cases of each command are in the planning doc, tab MVP skills. The phase 2 plan turns them into command files.

## Write policy

Reads run freely. A single write shows before → after (from `--dry-run`) and asks once. A bulk change (more than one record), an archive, a scope move or a published status update shows a full preview first. `write_policy.confirm: none` skips the single-write question, never the preview of a bulk change **(builder's call)**.

## Other agents

Commands are the source of truth. `scripts/package.mjs` (phase 3) generates, for Codex and OpenCode, one skill folder per command named `pmkit-<group>-<action>` (`pmkit-issues-create`), whose `SKILL.md` carries the command's description and procedure, plus the MCP server config. Claude Code needs none of it.

## Build order

1. Core and the Local tracker, with the CLI over them. Plan: `docs/superpowers/plans/2026-10-23-pmkit-core-local.md`.
2. GitHub git host, the routing skill, the 24 commands, README, CONTEXT.md and the marketplace entry. Plan to write after step 1.
3. MCP server and packaging for Codex and OpenCode.
4. Phase 2 commands (`dependency-map`, `flow-metrics`, `risk-radar`, `release-notes`, `triage`, `local-render`), then the Linear adapter.

## Open questions

- [ ] Every **(builder's call)** above.
- [x] Plugin version for the first marketplace entry: `0.1.0`. Decided.
