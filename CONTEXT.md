# pmkit

A plugin that gives development agents one set of commands for project work (issues, sprints, epics), the same whatever tracker the team uses.

## Language

**Tracker**:
The system that holds a team's issues, sprints and epics. In the MVP it is the Local tracker. Linear, Jira, GitHub Issues, GitLab and Azure DevOps come later. The `tracker.system` key in `.pmkit/config.yaml` names it, and `tracker.scope` names the workspace, team or project of a hosted tracker.
_Avoid_: backend, board, project management tool

**Git host**:
The service that hosts the repository and its pull requests. It is separate from the tracker. pmkit reaches GitHub through the `gh` and `git` CLIs and holds no token. `git_host.system` is `github` or `none`.
_Avoid_: forge, remote, provider

**Workspace**:
The Linear organization that a personal API key belongs to, named by its URL key in `tracker.scope.workspace`. The key comes from `LINEAR_API_KEY`, and pmkit stores it nowhere.
_Avoid_: organization, account

**Adapter**:
The code that implements the contract for one tracker or one git host and translates between that system and the common model. Only adapters know a specific system. The Local tracker adapter lives in `scripts/lib/local/`. The CLI picks the tracker adapter by `tracker.system` from the registry in `scripts/lib/adapters.mjs`, and commands reach it only through the contract operations.
_Avoid_: driver, connector, integration

**Issue**:
A unit of work: a title, a status, an optional type, priority, estimate, assignee, labels, a parent, links to other issues, a sprint, a release, a branch, a description and acceptance criteria. The Local tracker keeps it in `issues/<ID>/issue.md`.
_Avoid_: ticket, task, card

**ID style**:
How the Local tracker names a new issue or epic, set by `id_style` in `.issues/config.yaml`. `random` (the default) draws 4 Crockford base32 characters, as in `ISS-7K3Q`, so two branches never pick the same ID. `numbered` takes one more than the highest number in use, as in `ISS-12`. Both shapes stay valid, so changing the style keeps the existing IDs.
_Avoid_: ID format (the tracker format is the shape of the files), sequence

**Sub-issue**:
An issue whose `parent` names another issue or an epic. The parent's `children` list is computed from it, never stored.
_Avoid_: subtask, child ticket

**Epic**:
A larger body of work with a status, an optional start and target date, and published status updates. An issue belongs to an epic through `parent`, and the epic's progress counts every issue whose parent chain reaches it.
_Avoid_: initiative, project, deliverable (that is the contract's name for the operations on an epic)

**Milestone**:
A named target with an optional due date that issues and epics point to by id.
_Avoid_: release, phase, version

**Release**:
A version of the product, kept as `releases/<version>.md`, that issues point to through `release`. It may name a git tag, and it is `planned` until `release mark-released` records when it shipped.
_Avoid_: milestone (a milestone is a target, not a version), version (outside the file name), deploy

**Release notes**:
The done issues of a release, a sprint or a period, grouped by type and written for a user of the product. The command says which basis it used and whether the notes are a draft. `/pmkit:report:release-notes` writes them and saves them as a document after the user confirms.
_Avoid_: changelog (that is the plugin's own `CHANGELOG.md`), release (the object, not its notes)

**Sprint**:
A time box with a start, an end, a goal, a state (`planned`, `active` or `closed`) and a capacity per member. At most one sprint is `active`. The sprint's id is its start date. The Unified model calls it a cycle, and the CLI command group is `cycle`. A closed sprint records when it was closed, and velocity counts only the moves to `done` made up to that moment.
_Avoid_: iteration, cycle (outside the CLI and contract names)

**Status**:
A name a tracker gives to a step of its workflow, such as `In review`. Each status belongs to one category, and commands reason by the category.
_Avoid_: state (a sprint has a state, an issue has a status), column

**Category**:
One of seven fixed groups of statuses, in this order: `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`. Every adapter maps its statuses to categories. `done` and `canceled` are the terminal ones.
_Avoid_: status type, stage, phase

**Mapping**:
A line under `mappings` in `.pmkit/config.yaml` that ties a pmkit category, `blocked`, a field role or an issue type to a hosted tracker's own name, such as `in_review: In Review` or `bug: Bug`. Setup writes the mappings it infers and the ones the user answers. `none` means the team has no such status or field. When a mapping names something the tracker no longer has, every command stops and offers `/pmkit:setup`.
_Avoid_: binding, alias

**Blocked**:
The state of an issue when one of its `blocked_by` issues is not in a terminal category, or is missing. It is computed on each read. It is not a category and not a stored field.
_Avoid_: on hold, stuck, waiting

**Blocker chain**:
The open issues that block an issue or the issues under an epic, followed through their own blockers until none is left. A blocker in a terminal category no longer blocks, so the chain stops there. A missing blocker stays in the chain. `/pmkit:issues:dependencies` shows it.
_Avoid_: dependency tree, blocking tree

**Critical path**:
The heaviest chain of open issues, linked by blocker edges, that ends at an open issue of the target. Its length adds the estimates, as velocity does, or counts the issues when no open issue in the map has a numeric estimate. It is the chain that sets the earliest finish of the target.
_Avoid_: longest path, critical chain

**Stalled**:
An issue in `in_progress` or `in_review`, or an open pull request, with no activity for more than `stuck_business_days` business days. An issue's activity is its newest event and, with a git host, the last update of the open pull request of its branch. `pmkit risks` lists stalled issues and pull requests.
_Avoid_: stale (backlog grooming's term for old backlog issues), idle

**Thread**:
A root comment and its replies. Replies attach to the root, so a thread is one level deep. Resolving a thread resolves all of it. `resolveThread` marks the root, and a reply resolves the root of its thread.
_Avoid_: conversation, discussion

**Event**:
One line of an issue's `events.jsonl`, appended on each write. It has `at`, `by`, `op` (`create`, `update`, `move`, `assign`, `link`, `unlink`, `comment`, `log_time` or `archive`) and the changed field with its old and new values. Replaying the events gives the issue's state and feeds the metrics.
_Avoid_: log entry, activity, audit record

**Synthetic event**:
An event with `synthetic: true` that the adapter appends for a change nobody logged, found as drift. Its `at` is the later of the modification time of `issue.md` and the newest logged event, but never later than the write that finds the drift. Its `by` is the current actor.
_Avoid_: fake event, backfilled event

**Drift**:
The difference between an issue's frontmatter and the state its events lead to. It appears when someone edits `issue.md` by hand. Before each write the adapter replays the events, compares, and appends one synthetic event per differing field. An issue with no events at all, such as one written by hand, gets one synthetic `create` event that holds its whole frontmatter.
_Avoid_: desync, inconsistency

**Capability**:
A tracker feature that a command may depend on, such as `cycles`, `estimation` or `dependencies`. There are 20. Each one has a path in the manifest.
_Avoid_: feature, permission

**Capability manifest**:
The list of the 20 capabilities of one tracker instance, each with a path (`native`, `derived`, `conditional` or `absent`), an optional `detail` map and an optional `enableHint`. `pmkit capabilities` prints it. A command that needs an `absent` capability degrades instead of failing. The Local tracker computes the manifest on each run from the config.
_Avoid_: feature flags, support matrix

**Member**:
A person registered in `.issues/config.yaml` under an id, with a name, an email and an availability from 0 to 1. Assignees, authors and capacity keys are member ids.
_Avoid_: user, teammate, account

**Actor**:
The member who performs a write. It is the member whose `email` equals `git config user.email`. Without a match, the `PMKIT_USER` environment variable names the member id, and `--as <member>` overrides both. Without an actor, a write fails with `NOT_CONFIGURED`. Reads need one only to resolve `me`, as in `issues list --assignee me`.
_Avoid_: author (comments and status updates have an author), current user

**Local tracker**:
The tracker that keeps issues, epics, sprints and their history as plain files in the repository under `.issues/`, shared and versioned through git. It needs no account and no network. It is the reference implementation of the contract.
_Avoid_: file tracker, offline mode

**Query index**:
The cache of parsed issue files in `.issues/.cache/index.json`. Searches rebuild an entry when the stat signature of its `issue.md` changes. Git ignores the index. It is never a source of truth, and deleting it only makes the next search slower.
_Avoid_: database, search engine

**User store**:
The per-user folder `~/.config/pmkit/` (moved by `PMKIT_HOME` or `XDG_CONFIG_HOME`) that holds the discovery cache, whose entries expire after a TTL, and the personal defaults in `defaults.yaml`. It lives outside the repository and holds no credential. The code is `scripts/lib/user-store.mjs`.
_Avoid_: global config, home config

**Write policy**:
The `write_policy` block of `.pmkit/config.yaml`. `confirm` (`all_writes`, `single_writes` or `none`) says when a command asks before a write, and `preview` lists the changes that always show a full preview first (`bulk`, `delete`, `publish_update`, `move_scope`). `confirm: none` never skips a preview.
_Avoid_: permissions, approval mode

**Dry run**:
A write run with `--dry-run`. It validates the change, returns `{ before, after }` and writes nothing, not even the event log. Commands use it to show before and after in a confirmation.
_Avoid_: preview (a preview is the full listing of a bulk change), simulation

**Tracker format**:
The shape of the Local tracker's files, as one integer in the `version` key of `.issues/config.yaml`. It goes up only when the files change shape, not with each plugin release. The CLI holds the one format it reads and writes, which is 2 today. A repository on a newer format is refused for reads and writes, and one on an older format is read and not written, until `/pmkit:upgrade` migrates it.
_Avoid_: schema version, plugin version (the plugin has its own version in `plugin.json`)

**Migration**:
One step that takes the tracker format from one number to the next. Steps run in order and each one is one-way. `pmkit migrate` lists every file it would change with `--dry-run`, then applies the steps. It refuses outside git and while the tracker folder has uncommitted changes.
_Avoid_: upgrade (that is the command that updates the plugin and then runs the migrations), conversion
