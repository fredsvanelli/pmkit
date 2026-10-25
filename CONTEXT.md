# pmkit

A plugin that gives development agents one set of commands for project work (issues, sprints, epics), the same whatever tracker the team uses.

## Language

**Tracker**:
The system that holds a team's issues, sprints and epics. In the MVP it is the Local tracker. Linear, Jira, GitHub Issues, GitLab and Azure DevOps come later. The `tracker.system` key in `.pmkit/config.yaml` names it.
_Avoid_: backend, board, project management tool

**Git host**:
The service that hosts the repository and its pull requests. It is separate from the tracker. pmkit reaches GitHub through the `gh` and `git` CLIs and holds no token. `git_host.system` is `github` or `none`.
_Avoid_: forge, remote, provider

**Adapter**:
The code that implements the contract for one tracker or one git host and translates between that system and the common model. Only adapters know a specific system. The Local tracker adapter lives in `scripts/lib/local/`.
_Avoid_: driver, connector, integration

**Issue**:
A unit of work: a title, a status, an optional type, priority, estimate, assignee, labels, a parent, links to other issues, a sprint, a branch, a description and acceptance criteria. The Local tracker keeps it in `issues/<ID>/issue.md`.
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

**Sprint**:
A time box with a start, an end, a goal, a state (`planned`, `active` or `closed`) and a capacity per member. At most one sprint is `active`. The sprint's id is its start date. The Unified model calls it a cycle, and the CLI command group is `cycle`.
_Avoid_: iteration, cycle (outside the CLI and contract names)

**Status**:
A name a tracker gives to a step of its workflow, such as `In review`. Each status belongs to one category, and commands reason by the category.
_Avoid_: state (a sprint has a state, an issue has a status), column

**Category**:
One of seven fixed groups of statuses, in this order: `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done`, `canceled`. Every adapter maps its statuses to categories. `done` and `canceled` are the terminal ones.
_Avoid_: status type, stage, phase

**Blocked**:
The state of an issue when one of its `blocked_by` issues is not in a terminal category, or is missing. It is computed on each read. It is not a category and not a stored field.
_Avoid_: on hold, stuck, waiting

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
