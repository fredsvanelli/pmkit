# Changelog

## Unreleased

- Adds `/pmkit:issues:delegate` and `pmkit issues delegate <id> <agent:name>` (PMK-57). The Local tracker assigns the issue to the agent member and posts a comment with the instructions and the steps to run the agent locally through `/pmkit:issues:work` with `--as <agent>`. The command always asks before it delegates and before it runs the agent. `agent_delegation` is derived on the Local tracker (`source=assignee`, `run=local`). Linear answers `NOT_SUPPORTED` and lists `delegate` under `detail.unsupported`.
- Adds `/pmkit:issues:estimate` (PMK-59). It proposes an estimate from the code an issue affects and from similar completed issues, and saves it with `issues update --estimate` after one confirmation. When the tracker has no estimate field (the `estimation` capability is `absent`), it posts the estimate as a comment.
- Adds `/pmkit:issues:review` (PMK-61), which compares the diff of an issue branch with each acceptance criterion, marks each one covered, partly covered, gap or not checked, lists the changes outside the criteria, and posts the result as a comment after one confirmation. Adds `pr diff` and `prDiff` and `localDiff` on the GitHub git host: `pr diff` prints the pull request diff, or the local diff against the default branch when the branch has no pull request, and keeps the first `--max-lines` lines (default 2000). Every `gh` and `git` call of the host now times out after 120 seconds.
- Adds `pmkit docs list`, which lists the documents under `.issues/docs/` (PMK-50). The Local tracker lists them, and Linear answers `NOT_SUPPORTED`. A docs path that is a file answers `CONFLICT` with a next step.
- Adds `deploys list` and `ci logs` (PMK-49), and `listDeploys` and `ciLogs` on the GitHub git host. `deploys list` prints the repository deployments with the state of the latest status of each. `ci logs` prints the log of the failed steps of a run, either the one `--run` names or the newest failed run of a branch, and keeps the last `--tail` lines (default 200). A run that failed, timed out or never started counts as failed.
- Adds `issues time-entries <id>` (PMK-51), which lists the time logged on an issue with the total in minutes, as a table or with `--json`. On Linear it answers `NOT_SUPPORTED`, because Linear has no time tracking.
- Adds `pmkit alerts list`, which reads `npm audit --json` when the repository has a `package-lock.json` or `npm-shrinkwrap.json` and returns each advisory with a severity of `critical`, `high`, `medium` or `low` (PMK-48). `--severity` filters the list. A failing scanner is a warning and the text output says the result is incomplete. The `security_alerts` capability is derived (`source=scanners`) on the Local and Linear trackers, because the command reads the repository and not the tracker.

## 0.4.0 - 2026-10-30

- `/pmkit:issues:create` turns an idea into a full ticket before it creates anything. It reads the README, the docs, similar issues, the epics and the code, warns about likely duplicates, asks 2 or 3 short questions on context and scope, and drafts the description with `### Context`, `### Scope (in)`, `### Out of scope` and `### Tasks`, with the acceptance criteria in their own field. It always shows the full ticket for approval before it creates it.

Tracker format: 2

## 0.3.0 - 2026-10-28

- `/pmkit:setup` sets up a Linear repository. It infers the workspace and the team, asks which status means in review and blocked and which label stands for each issue type, and writes them to `.pmkit/config.yaml` after one approval.
- Adds `mappings.types` to `.pmkit/config.yaml`: a pmkit issue type to the name of one Linear label, such as `bug: Bug`. `none` is a valid value for `mappings.status` and `mappings.fields`.
- Every Linear operation except `discover` and `capabilities` stops with `NOT_CONFIGURED` and `error.mappings` when a mapping names a team, status, field or label the workspace no longer has.
- Adds `resolveMappings(view, pmkit)` in `scripts/lib/linear/mappings.mjs`, the one reader of `mappings` for Linear issue operations.
- The Linear tracker supports issues, relations and search (PMK-35). A move to a category whose only state is Duplicate is refused until `mappings.status.<category>` names it.
- The Linear tracker supports history, comments and metric events (PMK-36). `issues get --history`, `issues get --comments`, `events` and the flow metrics (`cycle-time`, `lead-time`, `throughput`, `aging`) work on Linear.
- Adds `issues comment --reply-to <comment>` and `issues resolve <id> <comment>` for comment threads, on the Local and Linear trackers.
- A Local comment file may hold `reply_to`, `resolved` and `resolved_by`. The keys are optional, and the tracker format stays 2.
- The Linear tracker maps cycles to sprints (PMK-37). `cycle list`, `cycle current`, `cycle issues` and `cycle add` work on a team with cycles on, and `--sprint` and the `sprint` field of an issue take a cycle number, `current` or `none`. The sprint id is the cycle number. `cycle open` and `cycle close` answer `NOT_SUPPORTED`, because Linear creates and ends cycles from the team schedule. The `cycles` capability carries `detail.open: false` and `detail.close: false` so a command can check before it offers either.
- Capacity and days off of a Linear cycle live in `.pmkit/capacity.yaml`, a file you commit. `cycle capacity` reads and writes it, and Linear is never written.
- Linear projects work as pmkit epics (PMK-38), with progress, health and project updates, read-only milestones and documents, and issue history shows the epic as the issue's `parent`.
- Adds an opt-in live run of the tracker contract suite against a Linear sandbox workspace (PMK-39), `scripts/lib/linear/contract-live.mjs`, with a fixed test team, a write guard, a request budget and a `cleanup` command. `npm test` stays offline and now removes `LINEAR_API_KEY` and `PMKIT_LIVE` from the environment of its tests.
- Linear history can miss an edit made right after the create. Linear folds it into the create entry, so `events` shows no `update` for it (PMK-39).
- Adds `/pmkit:local:migrate` and five commands (PMK-41). `local-migrate export` copies `.issues/` to a Linear team, `local-migrate import` copies a Linear team into an empty `.issues/`, `local-migrate status` reports the newest ID map, `local-migrate undo` deletes what an export created after a full preview, and `local-migrate switch` points `.pmkit/config.yaml` at the new tracker. Every write shows a full preview first and needs its digest, and a rerun resumes from the ID map under `.pmkit/migrations/`. An export loses the event history, the comment and status update authors, the status update dates, milestones, releases, time logs, documents, branch names, the old IDs, estimates outside the team's scale, sprint names and goals, and epic creation times. The tracker format stays 2.

Tracker format: 2

## 0.2.0 - 2026-10-25

- Adds numbered IDs for issues and epics, such as `ISS-1` and `ISS-2`, as an option to the random IDs. `id_style` in `.issues/config.yaml` picks one, and `random` stays the default.
- `/pmkit:setup` asks which ID style to use. It recommends random IDs for the Local tracker and numbered IDs for a remote tracker.

Tracker format: 2
Setup: setup asks whether issue and epic IDs are random or numbered. A tracker set up before keeps random IDs until you change `id_style`.

## 0.1.0 - 2026-10-24

- Adds the Local tracker. Issues, epics, sprints and documents live as files in `.issues/` in your repository.
- Adds the GitHub git host. Branches, pull requests and merged pull requests work through `gh`.
- Adds the commands for issues, epics, sprints, documents and metrics.
- Adds `/pmkit:setup` to configure a project.
- Adds `/pmkit:upgrade` to update pmkit and move `.issues/` to a newer format.
