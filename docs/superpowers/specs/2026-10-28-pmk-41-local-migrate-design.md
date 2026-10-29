# PMK-41 design: move a Local tracker to Linear and back

Issue PMK-41, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: answers applied on 2026-10-28 (see "Answers"). Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0001, ADR-0002, ADR-0004, ADR-0005, the PMK-30 to PMK-38 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

A team that starts on the Local tracker and moves to Linear has no way to take its issues along. A team on Linear has no way to take a snapshot into `.issues/`. Today they would recreate every issue by hand and lose the parents, the blockers and the links between issues.

Sources:

- Unified model, "System-specific skills", the `local-migrate` row: "Exports the local tracker to any hosted system through its adapter, or imports from one into .issues/, mapping IDs and keeping links". The same row in the Local adapter tab. The reason it is Local-specific: "Only the Local adapter is a natural starting point or snapshot target".
- MVP skills, MQ4: points "migrate cleanly to hosted trackers through `local-migrate`", so an estimate in points must arrive as the same number.
- The write policy in `skills/pmkit/references/conventions.md`: a bulk change always shows a full preview first, and `confirm: none` never skips it.

Acceptance criteria:

1. Exports `.issues/` to Linear and imports from Linear into `.issues/`.
2. Maps IDs and keeps parents, blockers and links.
3. Shows the full preview before writing.

Bound decisions from earlier issues:

- The Linear client sends a mutation once and never retries it, and it never waits for a rate-limit reset (PMK-30).
- Every write appears in Linear as the key's owner, and the adapter refuses another actor (ADR-0005, PMK-35).
- Linear cycles cannot be created through the API, so pmkit cannot open one (PMK-37).
- A Linear sprint id is the cycle number, an epic id is the project identifier (PMK-37, PMK-38).
- An issue joins an epic through `parent`. A project shows as the parent when the issue has no parent issue (PMK-38, "The parent rule").
- `.pmkit/capacity.yaml` holds Linear capacity (PMK-37).
- Live tests write only to ONE fixed, reusable test team: a fixed name prefix, cycles on, found or created by PMK-39's helper. A run never creates a team of its own and never writes to any other team. At the end it trashes what it created (user decision, PMK-41 answers, replacing the PMK-37 answer).
- The tracker format is one integer, and adding a key to an event changes it (ADR-0004). `EVENT_KEYS` in `scripts/lib/local/events.mjs` is fixed.

## Facts checked against the Linear API

Read-only introspection on 2026-10-28 against the sandbox workspace, through `createLinearClient` and a fetch wrapper that refused any mutation. Introspection reads the schema. It does not prove how a field behaves.

| Call | Result |
|---|---|
| `__type(IssueCreateInput)` | `id` (client-chosen), `teamId` (required), `title`, `description`, `assigneeId`, `parentId`, `priority`, `estimate`, `labelIds`, `cycleId`, `projectId`, `projectMilestoneId`, `stateId`, `dueDate`, `createdAt`, `completedAt`, `createAsUser`. There is no `number` and no `identifier`. |
| `__type(CommentCreateInput)` | `id`, `body`, `issueId`, `parentId`, `createdAt`, `createAsUser`. |
| `__type(ProjectCreateInput)` | `id`, `name` (required), `teamIds` (required), `statusId`, `description`, `content`, `startDate`, `targetDate`, `leadId`. |
| `__type(IssueRelationCreateInput)` | `id`, `type` (required), `issueId` (required), `relatedIssueId` (required). |
| `__type(IssueLabelCreateInput)` | `id`, `name` (required), `teamId`, `parentId`, `isGroup`. |
| `__type(ProjectUpdateCreateInput)` | `id`, `projectId` (required), `body`, `health`. There is no `createdAt`. |
| `__type(TeamCreateInput)` | `id`, `name` (required), `key`, `cyclesEnabled`, `cycleDuration`, `triageEnabled` and more. |
| `__type(Mutation)`, delete and archive | `issueDelete`, `issueArchive`, `issueUnarchive`, `projectDelete`, `commentDelete`, `issueRelationDelete`, `issueLabelDelete`, `teamDelete`. Linear also has its own importers (`issueImportCreateCSVJira`, `issueImportCreateLinearV2` and others). |
| `__type(IssueFilter)` | `id` takes an `IssueIDComparator`, so one read can check many UUIDs. |
| Rate-limit headers | `x-ratelimit-requests-limit: 2500` per hour and `x-ratelimit-complexity-limit: 3000000`, as PMK-30 measured. |

Consequences for the design:

- Every create takes an `id` that pmkit chooses. pmkit can record the UUID before it sends the create, and one read by UUID tells afterwards whether the create happened. This is how a rerun resumes.
- `createdAt` on issues and comments, and `completedAt` on issues, can carry the Local dates. The schema allows it. Whether a personal key may set them is unverified until the live test runs.
- `createAsUser` exists, but only an OAuth app may use it (ADR-0005). Comments arrive authored by the key owner.
- A project update has no `createdAt`, so a migrated status update is dated at the migration.
- No create takes a number, so a Linear identifier cannot be chosen. Export always gives new IDs.

## Goals

- `pmkit local-migrate export` writes the issues, epics, links, comments and status updates of `.issues/` to one Linear team.
- `pmkit local-migrate import` writes the issues, projects, cycles, comments, status updates and history of one Linear team into an empty `.issues/`.
- Both directions keep every parent, blocker, related link and duplicate link whose two ends are in the migration.
- `--dry-run` prints the full preview: every record, where it goes, every field that does not carry over, and the request count against the hour's budget. The run writes nothing a dry run did not list.
- An ID map file records each old ID and its new ID. A rerun reads it and resumes after a failure, a rate limit or an interruption, without creating a record twice.
- `pmkit local-migrate status` reads the map, and `pmkit local-migrate undo` deletes what an export created, after a full preview.
- `pmkit local-migrate switch` changes `tracker.system` after a finished migration. It is its own step, with its own dry run, and no other command changes `tracker.system`.
- `/pmkit:local:migrate` is the command that runs the preview, asks, and runs the move.

## Non-goals

- Sync. A migration copies a state once. A record changed after it was migrated is listed as changed and is not sent again.
- Other hosted trackers. The engine takes a reader and a writer per adapter, so a Jira or GitHub writer can follow, but this issue builds only the Linear pair and the Local pair.
- Creating Linear cycles (PMK-37), milestones and documents (PMK-38). The preview lists them as not carried over.
- Releases, time logs and Local documents under `.issues/docs/`. Linear has no release mapping in pmkit, no time tracking, and `createDocument` is `NOT_SUPPORTED`.
- Capacity and days off. They stay where they are: in the sprint files on Local and in `.pmkit/capacity.yaml` on Linear.
- Importing into a Local tracker that already holds issues or epics.
- Issues of other teams than the scope team.
- Using Linear's own importers. See "Approaches".

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to the Local tracker format or to any golden output.
- The key in any output, error, map file or command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.
- A record created twice in Linear by a rerun.
- A write that the preview did not show.
- A test that writes to any team other than the fixed test team.

## Approaches

### How the records reach the target

1. **Replay through the contract.** The engine reads the source through contract operations and writes the target with `createIssue`, `setParent`, `link`, `comment`, `createDeliverable` and `moveToCycle`. It is generic over adapters. It costs about three requests per issue and five per link, because each contract call reads its records and checks the viewer first. On pmkit's own tracker (165 issues, 10 epics, 148 links, 88 comments) that is about 1,360 requests, more than half of the hour's budget. `createIssue` picks its UUID inside the adapter, so the engine cannot record it before the create, and a crash between the create and the map write leaves an issue that a rerun creates again. The contract also has no way to set an epic's status, a creation date or a comment author, so a Local import would date every record at the import.
2. **A shared engine with a reader and a writer per adapter.** One engine plans, previews, orders the writes, keeps the ID map and resumes. Each adapter gives it a reader that returns a snapshot of the source in the common model, and a writer that creates one record at a time with a UUID or ID the engine chose. The Linear writer sends one mutation per record, with every field in the create, so the same tracker costs about 430 requests. The Local writer writes files through the Local serializers and keeps the original dates and authors. It is more code than approach 1 and a new adapter needs its own writer.
3. **Linear's own importer.** pmkit would write a CSV in a format Linear imports (`issueImportCreateCSVJira`) and let Linear run the import. It returns no ID map, the CSV formats carry no links between issues, the job runs asynchronously on Linear's side, it needs an admin, and it only goes one way.

Chosen: approach 2. Only it can record IDs before the write, which acceptance criterion 2 and a safe resume both need, and it fits the request budget.

### Where the ID map lives

a. **A committed file in the repository**, one per migration, under `.pmkit/migrations/`. The team shares it through git. It survives a move to another machine. After an export it is the one place that turns an old ID in a branch name, a commit message or the changelog into the new one. A rerun on any clone resumes from it.
b. **The user store.** Only the person who ran the migration has it, and a rerun from another clone starts over.
c. **The tracker.** A marker in each Linear description or a Local frontmatter key. The Linear marker changes the description that a later import reads back, and a Local key changes the tracker format (ADR-0004).

Chosen: a.

## Design

### Commands

| CLI | What it does |
|---|---|
| `pmkit local-migrate export [--workspace acme --team ACME] [--status cat=Name] [--type-label type=Label] [--field estimate=native\|none] [--expect <digest>] [--dry-run]` | Moves `.issues/` to the Linear team. A rerun resumes. |
| `pmkit local-migrate import [--workspace acme --team ACME] [--path .issues] [--expect <digest>] [--dry-run]` | Copies the Linear team into an empty `.issues/`. |
| `pmkit local-migrate status [--file <map>]` | Prints the map: direction, counts by state, failures, next step. Sends no request. |
| `pmkit local-migrate undo [--file <map>] [--expect <digest>] [--dry-run]` | Deletes what an export created (Linear moves it to the trash). For an import map it prints the git commands and writes nothing. |
| `pmkit local-migrate switch --to linear\|local [--file <map>] [--dry-run]` | Writes `tracker.system`, the scope and the mappings of a finished map to `.pmkit/config.yaml`. Writes nothing else. |

`/pmkit:local:migrate` (`commands/local/migrate.md`) is the procedure. It runs the dry run, shows the preview, asks with `AskUserQuestion` whatever `write_policy.confirm` says, then runs the same command with `--expect <digest>` from the dry run. After a finished migration it offers `switch` as a separate question, with its own dry run.

**Sides.** One side is always the Local tracker. The other side is Linear.

- The commands run when `tracker.system` is `local` or `linear`. A new command property, `systems: ['local', 'linear']`, replaces `local: true` for them and is checked at the same place in `run()`.
- The Linear side comes from `--workspace` and `--team` when given, else from the map being resumed, else from `tracker.scope` in `.pmkit/config.yaml`. The mappings come the same way. The flags are the ones of `init --tracker linear`, parsed by `parseMappingFlags`, and `proposeMappings` from `scripts/lib/mappings.mjs` fills in what it can infer. When a mapping is still open, the command stops with `NOT_CONFIGURED` and the list of questions, as setup does, and `/pmkit:local:migrate` asks them.
- The Local side is `tracker.path` (default `.issues`) when `tracker.system` is `local`, and `--path` (default `.issues`) otherwise. Its `config.yaml` must exist. `pmkit init` creates it.

So a Local repository exports and imports with flags, and a Linear repository exports from or imports into its `.issues/` with the Linear side from its own config. That is how a team goes back.

**Refusals before any read of the target:**

- The repository is not a git repository: `NOT_CONFIGURED`, as `migrate` does.
- The Local tracker folder has uncommitted changes: `CONFLICT`, as `migrate` does. The map records the commit the source was read at, and git is the way back from an import.
- Import, and the Local tracker holds an issue or an epic: `CONFLICT`, `import needs a Local tracker with no issues and no epics`, next step `Move the old records out with git rm -r .issues/issues .issues/epics .issues/sprints, commit, and run the import again`. Git keeps the old files.
- The Local tracker is on an older or newer format: the `formatError` of ADR-0004.
- Export, and `--as` names someone other than the key owner: the `requireViewer` error of PMK-35.

### Files

| File | Change |
|---|---|
| `scripts/lib/migrate/snapshot.mjs` | New. The snapshot shape below, its validation and `snapshotDigest`. Pure. |
| `scripts/lib/migrate/plan.mjs` | New. `planMigration({ snapshot, target, map, budget })` returns the steps, the records, the losses, the problems and the request count. Pure. |
| `scripts/lib/migrate/id-map.mjs` | New. Reads, creates and writes the map file. Each write is atomic through `writeFileAtomic`. |
| `scripts/lib/migrate/run.mjs` | New. Runs a plan through a writer, one record at a time, with the write-ahead rule, the budget check and the stop on failure. |
| `scripts/lib/migrate/preview.mjs` | New. The text and JSON preview of a plan. Pure. |
| `scripts/lib/linear/migrate-reader.mjs` | New. The snapshot of one Linear team, from bulk reads. |
| `scripts/lib/linear/migrate-writer.mjs` | New. The Linear writer: `exists`, `create` per kind, `remove` per kind, `budget`. |
| `scripts/lib/local/migrate-reader.mjs` | New. The snapshot of `.issues/`, from the Local tracker's reads and its event, comment and update files. |
| `scripts/lib/local/migrate-writer.mjs` | New. The Local writer: issue, epic, sprint, comment and update files with the original dates and authors, and the config changes. |
| `scripts/lib/linear/documents.mjs` | New documents: `ISSUES_BY_IDS`, `COMMENTS_BY_IDS`, `LABEL_CREATE`, `ISSUE_DELETE`, `LABEL_DELETE`. The writer reuses `ISSUE_CREATE` (its `IssueCreateInput` already takes `createdAt` and `completedAt`), `RELATION_CREATE`, `COMMENT_CREATE`, `COMMENT_RESOLVE`, `ISSUE_ARCHIVE` and `ISSUE_EVENTS_QUERY`. |
| `scripts/lib/linear/projects.mjs` | New documents: `PROJECTS_BY_IDS`, `PROJECT_STATUSES`, `PROJECT_DELETE`. The writer reuses `PROJECT_CREATE` and `PROJECT_UPDATE_CREATE`, and the reader `PROJECTS_QUERY` and `PROJECT_UPDATES_QUERY`. |
| `scripts/pmkit.mjs` | The five commands, the `systems` property, the text output, and `details.problems` in a JSON error. |
| `commands/local/migrate.md` | New. The procedure of `/pmkit:local:migrate`. |
| `skills/pmkit/SKILL.md` | Routes "move the tracker to Linear", "import from Linear" and similar requests to the command. |
| `scripts/fake-linear-api.mjs` | The fake learns the new documents, `createdAt` on creates, `id: { in }` on issues, projects and comments, and deletes. |
| `scripts/lib/linear/migrate-live.mjs` | New. The opt-in live test (see "Live test"). `npm test` does not load it. |
| `scripts/lib/linear/API-VERIFICATION.md` | A row per fact above, marked `schema`, and the live results once the live test runs. |
| `CONTEXT.md` | Entries for **Export**, **Import** and **ID map**. The **Migration** entry gains to its _Avoid_ line that moving records between trackers is an export or an import. |
| `CHANGELOG.md` | The release entry. |
| Tests | `snapshot.test.mjs`, `plan.test.mjs`, `id-map.test.mjs`, `run.test.mjs`, `preview.test.mjs` next to the modules, reader and writer tests per adapter, and CLI cases in a new `scripts/cli-migrate.test.mjs`. |

### The snapshot

A reader returns one snapshot. Every record carries its source ID, so the plan never asks the source again.

```js
{
  system: 'local' | 'linear',
  scope: { path: '.issues' } | { workspace: 'acme', team: 'ACME' },
  read: '2026-10-28T20:00:00Z',
  commit: '87cc467',               // Local only
  people: [{ id, name, email, app }],  // Local members or Linear users
  labels: ['needs-criteria'],
  epics: [{ id, title, status: { name, category }, start, target, description, created, updates: [{ id, at, author, health, body }] }],
  sprints: [{ id, name, start, end, goal, state, closed }],
  issues: [{ id, title, type, status: { name, category }, priority, estimate, assignee, labels, parent, sprint, milestone,
             release, due, branch, description, acceptanceCriteria, archived, created, completed, events }],
  links: [{ kind: 'blocks' | 'related' | 'duplicate', from, to }],
  comments: [{ id, issue, author, created, body, parent, resolved }],
}
```

- `links` holds each link once. A Local `blocked_by: [A]` on B is `{ kind: 'blocks', from: A, to: B }`. A Local `duplicate_of: [A]` on B is `{ kind: 'duplicate', from: B, to: A }`. A related pair is stored with the lower ID first.
- `completed` is the time of the newest move to a terminal category, or null.
- `events` is filled only by the Linear reader, from PMK-36's normalizer, and the Local writer uses it on import (see "History").
- `snapshotDigest(snapshot)` is a SHA-256 of the snapshot with sorted keys. The map stores it.

The Local reader uses the Local tracker's own reads (`searchIssues` with archived issues, `listDeliverables`, `listStatusUpdates`, `listCycles`, `listComments`) plus `readEvents` for `completed`. It sends no request.

The Linear reader pages `ISSUE_EVENTS_QUERY` for the scope team with `includeArchived: true`, so one page of 100 issues brings their relations, history and comments. It completes the nested lists that have a next page, as `metricEvents` does, and passes `maxPages` so the page cap of 10 does not cut a large team. It reads the projects with `PROJECTS_QUERY`, each project's updates with `PROJECT_UPDATES_QUERY`, and the cycles with `CYCLES_QUERY`. Issues are mapped with `toIssue`, projects with `toEpic`, cycles with `toSprint`, so the snapshot holds the same values the commands show.

### The ID map

One file per migration, `.pmkit/migrations/<YYYY-MM-DD>-<direction>-<system>.yaml`, such as `.pmkit/migrations/2026-10-28-export-linear.yaml`. A second migration on the same day adds `-2`. The CLI writes it and never commits it. The command tells the user to commit it with the tracker change.

```yaml
version: 1
direction: export
started: 2026-10-28T20:00:00Z
finished: null
source: { system: local, path: .issues, commit: 87cc467, digest: "sha256:..." }
target: { system: linear, workspace: acme, team: ACME }
mappings: { status: { in_review: In Review }, types: { bug: Bug }, fields: { estimate: native } }
people: { fred: 4f1c9a2e-0000-0000-0000-000000000001 }
records:
  label:
    needs-criteria: { state: done, uuid: 1b2c..., created: true }
  epic:
    EPC-5: { state: done, uuid: 9a1f..., id: P-ACM-3, at: 2026-10-28T20:00:04Z }
  issue:
    PMK-38: { state: done, uuid: 5e6d..., id: ACME-12, at: 2026-10-28T20:00:09Z }
    PMK-39: { state: sent, uuid: 77ab... }
  link:
    "blocks PMK-35 PMK-38": { state: done, uuid: 0c3d... }
  comment:
    "PMK-38/2026-10-28T18-11-19Z-fred": { state: failed, uuid: 2f4e..., error: { code: UPSTREAM, message: "..." } }
```

- `state` is `sent`, `done` or `failed`, and `removed` after an undo. A record the plan has not reached has no entry. `at` is the time the entry became `done`, which undo compares with Linear's `updatedAt`.
- On export, `uuid` is the UUID pmkit chose and `id` is what Linear returned (the identifier of an issue, the canonical epic id of a project). On import, the keys are the Linear IDs and `id` is the new Local ID.
- `people` records the member to user match the run used, and `mappings` the mappings, so a resume uses the same ones and asks nothing again.
- The file is written after every state change. A crash loses at most the state of the one record in flight, and that record is `sent`.
- An unreadable file, or another `version`, fails with `INVALID_INPUT`, `.pmkit/migrations/<file> is not valid: <why>`, next step `Fix the file; do not delete it while the migration is unfinished`. It is never overwritten.

**Which map a run uses.** Export and import look for the newest map with the same direction, the same target and `finished: null`. When there is one, the run resumes it. When the newest one is finished, a new run plans only the records the finished map lacks, so a rerun after a finished export sends the issues added since. `--file` names a map.

**IDs that round-trip (builder's call).** An import looks for a finished export map whose target is the same team. A Linear issue or project listed there gets its old Local ID back when that ID matches the current `id_prefix` or `epic_prefix`. Export then import gives back `PMK-38`, so branch names and commit messages still match. Every other record gets a new ID by `id_style`.

### Order of writes

Export, in this order. Each step finishes before the next starts.

| Step | Linear write | Requests | Notes |
|---|---|---|---|
| 0. Reads | `PmkitSession`, a refreshed discovery (7 requests), `PROJECT_STATUSES`, `CYCLES_QUERY` when any sprint is planned and the team has cycles on, one `*_BY_IDS` read per kind with `sent` entries | about 10 | The discovery is refreshed, because the plan must see the team as it is. |
| 1. Labels | `issueLabelCreate` with `teamId` | 1 per missing label | Every Local label and every label that `mappings.types` names, when neither the team nor the workspace has it **(builder's call)**. |
| 2. Epics | `projectCreate` with `id`, `name`, `teamIds`, `content`, `startDate`, `targetDate`, `statusId` | 1 per epic | The status comes from the category: `backlog` and `triage` to the `backlog` type, `todo` to `planned`, `in_progress` and `in_review` to `started`, `done` to `completed`, `canceled` to `canceled`. This is PMK-38's map read the other way. |
| 3. Issues | `issueCreate` with `id`, `teamId`, `title`, `description`, `stateId`, `labelIds`, `priority`, `estimate`, `assigneeId`, `parentId`, `projectId`, `cycleId`, `dueDate`, `createdAt`, `completedAt` | 1 per issue | Parents before children (below). |
| 4. Links | `issueRelationCreate` with `id`, `type`, `issueId`, `relatedIssueId` | 1 per link | Both ends must be in the map as `done`. |
| 5. Comments | `commentCreate` with `id`, `issueId`, `body`, `parentId`, `createdAt` | 1 per comment | Roots before replies, oldest first. The body starts with the attribution line (below). |
| 6. Threads | `commentResolve` on the root | 1 per resolved thread | |
| 7. Status updates | `projectUpdateCreate` with `id`, `projectId`, `body`, `health` | 1 per update | Oldest first, so the project ends with the newest health. |
| 8. Archive | `issueArchive` | 1 per archived issue | Last, so the links and comments of an archived issue go in first. |

**Field by field (export).**

- `status`: the Linear state of the team with the same name in the same category when there is one, else `targetState(category)` from `resolveMappings` (PMK-34) **(builder's call)**.
- `type`: the label that `mappings.types` names. `labels`: the labels with the same names.
- `estimate`: the same number when the team's scale holds it (MQ4), else dropped.
- `assignee`: the Linear user whose email equals the member's email, ignoring case. An app user never matches. No match leaves the issue unassigned (losses table).
- `parent`: an issue parent gives `parentId`. An epic parent gives `projectId`. An issue whose parent chain reaches an epic also gets that epic's `projectId`, so Linear's project view lists it, and the parent rule still shows the parent issue **(builder's call)**.
- `sprint`: the cycle of the team whose `toSprint` start and end equal the sprint's start and end. No match gives no cycle.
- `description` and `acceptanceCriteria`: `buildDescription` from PMK-35, the same text an update writes.
- `createdAt`: the Local `created`. `completedAt`: `completed`, only for a `done` issue.
- Comment `body`: the attribution line `Comment by <name> on <YYYY-MM-DD> in <old id>`, a blank line, then the Local body. `<name>` is the author's `name` in `members` (the member id when the author is not a member), the date is the UTC date of `created`, and `<old id>` is the Local issue ID. Example: `Comment by Ana Souza on 2026-10-28 in ISS-5N1R`.

**Parents first.** Issues go in an order where each parent issue comes before its children, and inside that order by creation time. A parent loop in hand-edited files is a plan problem (below), so the run never starts with one.

**Import** writes files, so it has no request cost after the reads. Its order is the same idea: `config.yaml` changes, sprints, epics with their updates, issues with their events, comments. Links live in the issue frontmatter, so they are written with the issue. An issue's `blocked_by` may name an issue that is written later, because the Local tracker treats a missing blocker as blocking until it exists.

### What does not round-trip

The plan builds a `losses` list. Each item names what is lost, how many records it touches, and why. The preview prints it under "will not carry over".

| Direction | What | What happens | Why |
|---|---|---|---|
| Export | Sprints without a Linear cycle of the same dates | The issues get no cycle. The sprint is listed. | Linear creates cycles from the team schedule and the API cannot open one (PMK-37). |
| Export | Sprint names and goals | Lost. The Linear cycle of the same dates keeps its own name. An import names the sprint after the cycle. | The export reuses a cycle and does not rename it. |
| Export | History | `events.jsonl` is not replayed. Linear's history starts at the migration, with `createdAt` and `completedAt` set from Local. | Linear's history is written by Linear only. |
| Export | Epic creation time | The project shows the migration time. | The export sends no `createdAt` for a project. |
| Export | Comment authors | Linear shows the key owner as the author. The attribution line names the original author. | `createAsUser` needs an OAuth app (ADR-0005). |
| Export | Status update dates and authors | Dated at the migration, authored by the key owner. | `ProjectUpdateCreateInput` has no `createdAt`. |
| Export | Milestones on issues and epics | Dropped. | A Linear milestone belongs to one project, and pmkit cannot create one (PMK-38). |
| Export | Releases, time logs, documents | Dropped. | No Linear mapping in pmkit. |
| Export | Branch names | Linear names the branch of each new issue. The map keeps the old ID. | `IssueCreateInput` has no branch. |
| Export | IDs | New identifiers. The map keeps the old ones. | No create takes a number. |
| Export | Estimates outside the team's scale, or with estimates off | Dropped. | PMK-35 refuses them. |
| Export | Members with no Linear user of the same email | Unassigned. | Linear assigns users. |
| Export | Links to issues that do not exist | Dropped. | No end to link to. |
| Export | Capacity and days off | Not moved. | Non-goal. |
| Import | Project milestones and documents | Dropped, and `milestone` on the issue too. | Local milestones belong to no epic. |
| Import | Parents and links to issues of other teams | Dropped. | The import reads the scope team only. |
| Import | Labels in a Linear label group | Imported as plain labels. | Local labels have no groups. |
| Import | Estimates outside the Local scale | Dropped. | `requireEstimate` refuses them. |
| Import | Linear statuses without a Local status of the same name | The Local status of that category. | Local statuses are configured, not discovered. |
| Import | Cycle schedule (duration, cooldown) | Not moved. Each cycle becomes one sprint file with its dates. | Local sprints have no schedule. |
| Import | IDs | New Local IDs, except the ones an export map gives back. | |

**Plan problems** are different from losses. A problem is a record that cannot go in as it is and has no sensible default: a category the team has no state for and no mapping covers, a type with no label mapping, a parent loop, a title Linear would refuse because it has a line break. The plan collects every problem. When the list is not empty, the dry run shows them and the run refuses with `INVALID_INPUT`, the first problem in the message and all of them in `details.problems`, before any write.

### History on import (builder's call)

Import writes each issue's history as Local events, so flow metrics and velocity work on the snapshot.

1. The events come from PMK-36's `toEvents`, which already gives the Local shape and, on the live check, replays to the same state as `getIssue`.
2. `by` becomes the member the person maps to (see "People").
3. The writer writes `issue.md`, then the events, then runs `driftEvents` over the result. When the replay differs from the frontmatter, it appends the synthetic events that drift detection would, dated at the import and authored by the actor. The next write then finds no drift.

The reads already bring the history with the issues, so this costs no extra request in most teams. An issue with more than 50 history entries costs one more request per extra page.

### People

**Export.** A member matches the Linear user with the same email, ignoring case. The preview lists each member with its match or "no Linear user". The run uses the matches it recorded in the map.

**Import.** A Linear user matches the member with the same email, ignoring case. Each user that an imported record names (assignee, comment author, history actor, update author) and that matches no member is added to `members` in `.issues/config.yaml` as `{ name, email, availability: 1 }`. The preview lists each one as `new member <id>`. The member id is the part of the email before `@`, lower-cased, with every run of characters outside `a-z`, `0-9` and `-` replaced by one `-`, and leading and trailing `-` removed. A clash with a member id or an id added earlier in the same run gets `-2`, then `-3`. An app user becomes `agent:<id>` by the same rule applied to its name, which `MEMBER_ID` allows, and gets no email. A user with an empty id after the rule gets `user`, then `user-2`.

**Comment authors on import.** A comment whose body starts with an attribution line of exactly the export shape, followed by a blank line, loses those two lines. When `<name>` equals the `name` of exactly one member, that member is the author and the Linear author is ignored. Otherwise the author is the member the Linear user maps to.

### The preview (criterion 3)

The dry run plans, prints and writes nothing, not even the map. It sends only the reads of step 0, plus the bulk reads of the source on import.

**Text:**

```
export .issues/ (commit 87cc467) to Linear team ACME in workspace acme
source: 165 issues, 10 epics, 3 sprints, 148 links, 88 comments, 0 status updates
target: team ACME holds 0 issues

step  what                                         records  requests
0     reads before the first write                       -        10
1     labels to create                                   2         2
2     epics as projects                                 10        10
3     issues                                           165       165
4     links (86 blocks, 62 related, 0 duplicate)       148       148
5     comments                                          88        88
6     resolved threads                                   3         3
7     status updates                                     0         0
8     archived issues                                    0         0
      total                                                      426
budget: 426 requests of 2488 left this hour (resets 21:06Z), 100 kept in reserve

people
  fred   Fred <fred@example.com>   matches Linear user Fred

epics
  EPC-5   Linear tracker adapter    new project, Backlog

issues
  PMK-1   Add the config loader     new issue, Done, parent EPC-1, sprint 2026-10-12 has no cycle
  ...

links
  PMK-35 blocks PMK-38
  ...

will not carry over
  sprints      3 sprints have no Linear cycle with the same dates; 41 issues will have no cycle
  history      events.jsonl is not replayed; creation and completion dates are kept
  comments     88 comments will show the key owner as author; each starts with a line naming the original author
  milestones   12 issues lose their milestone
  ...

digest: sha256:4be1...
dry run: nothing was written
```

- Every record has a line, so the preview is full as the write policy asks. The command shows the summary table and the losses, and gives the record lists as tables.
- On a resume, a fourth column says how many records are `done`, `sent` and still to send, and the record lines show `done ACME-12` for the ones the map holds.
- When the total exceeds what is left minus the reserve, the budget line says `the run stops after about N writes; run it again after 21:06Z to finish`.

**JSON:** `{ direction, source, target, steps: [{ step, kind, records, requests }], records: { label, epic, issue, link, comment, thread, update, archive }, people, losses: [{ what, count, ids, why }], problems, budget: { requests, remaining, reserve, resetAt, fits }, resume: { map, done, sent, failed }, digest }`. Each record entry is `{ source, action: 'create' | 'skip', target, fields, dropped }`, where `dropped` lists the field names that do not carry over for that record.

**The digest.** `digest` is a SHA-256 over the plan's records and actions. The run recomputes the plan. When `--expect` is given and the new digest differs, the run refuses with `CONFLICT`, `the plan changed since the preview`, next step `Run the dry run again and confirm the new preview`, before any write. The command always passes `--expect`, so the user never approves one plan and runs another **(builder's call)**.

### Running and resuming

`run.mjs` takes the plan, the map and a writer, and goes through the records in step order.

1. **Check.** Before the first write, every `sent` entry is looked up by UUID, one `*_BY_IDS` read per 100 entries and per kind. Links are checked through the relations of their `from` issue. A found record becomes `done` with its ID. A missing one is sent again with the same UUID.
2. **Write ahead.** For each record, the map gets `state: sent` and the UUID, the file is written, then the mutation goes out.
3. **Answer.** On success the entry becomes `done` with the returned ID. The map is written again.
4. **Stop on failure.** Any error stops the run at that record. An `UPSTREAM` that says Linear did not confirm the change gets one read by UUID, as `createIssue` does today. Found means `done`, and the run goes on. Otherwise the entry becomes `failed` with the error's code and message, the map is written, and the command exits with code 2. The error's `written` carries the counts, so the output still shows what was done. The next step is `Fix the cause and run pmkit local-migrate export again to resume`.
5. **Finish.** When every record is `done`, `finished` gets the time.

The engine never skips a failed record and never sends a mutation twice for one attempt. A second create with a UUID that exists should fail in Linear rather than duplicate. That is unverified, so step 1 reads before it resends.

Import uses the same loop. The Local writer writes each record's files atomically, and `exists` checks whether the record's folder or file is there.

### Pacing and the request budget

The engine sends one request at a time and waits for each answer. It does not sleep between requests.

Before each write, it reads `client.rateLimit()`. When `requests.remaining` is at or below a reserve of 100, or `complexity.remaining` is at or below 10,000, it stops before the write. The map is saved, the exit is code 2 with `RATE_LIMITED`, `stopped before Linear's request limit: <done> of <total> records are done`, next step `Run the same command again after <resetAt> to resume`. The reserve leaves room for the user's other pmkit commands and for the check of the next run. The client never waits for a reset (PMK-30), and neither does the engine.

**Request count.** For an export of `I` issues, `E` epics, `L` missing labels, `K` links, `C` comments, `T` resolved threads, `U` status updates and `A` archived issues:

```
requests = 10 + L + E + I + K + C + T + U + A + ceil(sent / 100) per kind
```

The 10 is the session, seven discovery requests, the project statuses and the cycles. pmkit's own tracker today (165 issues, 10 epics, 148 links, 88 comments) needs about 426 requests, 17% of the hour's 2500. A tracker of 1,000 issues with as many links and comments in proportion needs about 2,600 and finishes in two runs an hour apart.

An import of `I` issues, `E` projects and `S` cycles needs about:

```
requests = 8 + ceil(I / 100) + (issues with a nested list past its first page) + ceil(E / 100) + E + ceil(S / 100)
```

For 165 issues and 10 projects that is about 25 requests. The Local writes cost none.

An undo of an export needs `10 + I + E + L` requests.

### Undo

**Export.** `local-migrate undo` reads the map and deletes what the export created, newest step first: `issueDelete` for each issue, which takes its links and comments with it, `projectDelete` for each project, and `issueLabelDelete` for each label the map marks `created: true`. It takes `done`, `sent` and `failed` entries: the export chose each UUID and wrote it to the map before the create, so a `sent` or `failed` record Linear has is the export's, and one Linear lacks shows as already gone. It first reads every issue by UUID, and every `sent` or `failed` project and label, and lists the issues changed in Linear after the export (`updatedAt` later than the map's `done` time) under "changed since the migration". The dry run is the full preview, as for any delete in the write policy: every issue, project and label it deletes, with the changed ones marked, and a digest. The run takes `--expect` as export does. Each removal is written to the map (`state: removed`), so an interrupted undo resumes too. `issueDelete` is sent without `permanentlyDelete`, so Linear keeps the issue in its trash.

**Import.** The import refused a dirty tracker folder, so the commit before it is the way back. `local-migrate undo` on an import map prints `git restore --source=HEAD -- .issues .pmkit/migrations` and `git clean -fd -- .issues`, and writes nothing.

### Switching the tracker

A finished export leaves `tracker.system: local`, and a finished import leaves a Linear repository on Linear. Export and import never change `tracker.system`. `pmkit local-migrate switch --to linear|local` is the separate step.

- It takes the newest finished map, or `--file`. `--to linear` needs an export map and `--to local` an import map; the other direction is `INVALID_INPUT`, `switch --to linear needs a finished export map`.
- It refuses with `CONFLICT`, `the migration in <file> is not finished` (or `has <n> failed records`), next step `Run pmkit local-migrate status`, unless `finished` is set and no record is `failed`.
- `--to linear` writes `tracker.system: linear`, `tracker.scope.workspace`, `tracker.scope.team` and the `mappings` the map used. `--to local` writes `tracker.system: local` and `tracker.path` from the map's Local side. It leaves `tracker.scope` and `mappings` in place, because the Local tracker ignores them (`validatePmkitConfig`). It leaves `.issues/` and `.pmkit/capacity.yaml` alone.
- `--dry-run` prints the line diff of `.pmkit/config.yaml` and writes nothing. When the file already says the target system, the command says so and writes nothing.
- It runs on either system, sends no request, and never commits. `/pmkit:local:migrate` asks before it, as a scope move in the write policy.

## Testing

All tests run in `npm test` over `fakeLinearFetch` and temporary repositories from `scripts/test-helpers.mjs`. No test opens a socket.

- `plan.test.mjs`: the order (parents first, roots before replies, archive last), every row of the losses table, each plan problem, the request count, the reserve line, the digest changing when a record changes.
- `id-map.test.mjs`: create, write after every state change, the file name with `-2`, a bad file refused and kept, the choice of the map to resume.
- `run.test.mjs` over a fake writer: a failure at record k stops with k−1 `done` and one `failed`; a rerun resumes and sends each record once; a `sent` record that exists becomes `done` with no create; an unconfirmed create found by UUID; the reserve stop; `--expect` with a changed plan.
- Linear writer and reader over the fake: each create sends the fields listed above, with the chosen UUID; the bulk reads page; `exists` reads by UUID.
- Local writer and reader: the files read back through the Local tracker; dates and authors kept; history replays with no drift; `config.yaml` changes.
- A round trip over the fake: a Local fixture with a parent chain, an epic, a blocker pair, a related pair, a duplicate, a comment thread, a resolved thread, an archived issue and a sprint. Export, then import into a second empty repository with the export map present, gives back the same IDs, parents, blockers and links. Every difference matches a row of the losses table.
- CLI cases: the refusals, the text and JSON preview, `status`, `undo --dry-run`, `switch` and its refusals.
- Attribution: the export body starts with the line, and an import of that body removes it and gives back the author.
- People on import: a user with no member becomes one by the id rule, with `-2` on a clash and `agent:` for an app user.
- No existing golden changes. The five new commands get new golden cases.

### Live test

`scripts/lib/linear/migrate-live.mjs` runs only when `PMKIT_LIVE=1`, `PMKIT_LIVE_WORKSPACE` and the write opt-in are all set, and the key is usable. Otherwise every test is skipped with the reason. The write opt-in is `PMKIT_LIVE_WRITE=1`, unless PMK-39's helper names another variable; then this file uses that one.

```
set -a; . ./.env; set +a; PMKIT_LIVE=1 PMKIT_LIVE_WRITE=1 PMKIT_LIVE_WORKSPACE=$PMKIT_LIVE_WORKSPACE node scripts/lib/linear/migrate-live.mjs
```

It writes only to the one fixed, reusable test team: a fixed name prefix and cycles on. PMK-39's helper finds that team, or creates it once when the workspace lacks it. The run never creates a team of its own and never writes to any other team. In an `after` hook that runs even when a test fails, it trashes every issue and deletes every project and label the run created, through the helper, and leaves the team in place. It keeps the fixture small (five issues, one epic, three links, three comments), so one run costs about 60 requests.

1. Find or create the test team through PMK-39's helper.
2. Check that the export's target team id equals the id the helper returned, before the first write. Any other team stops the test.
3. Export the fixture with `--dry-run`, then for real. Read back parents, blockers, links, the project, the dates and the attribution lines.
4. Interrupt a second export after two mutations with a fetch wrapper that fails, then run it again and check that nothing is created twice.
5. Import into a new temporary repository, and compare with the losses table. The comment authors come back from the attribution lines.
6. Undo, and check that the team holds no issue the run created.
7. Trash what is left of the run through the helper. The team stays for the next run.

**What this test needs from PMK-39.** PMK-39 merges first and owns the helper. This issue imports no code from its branch: the live test is the one part that waits for the merge, and the plan puts it in a separate last task. It needs from the helper:

- A function that finds the fixed test team by its name prefix, or creates it with cycles on and a state of each category including an In Review state, and returns `{ id, key }`.
- A function that trashes the issues and deletes the projects and labels a run created, safe to call twice.
- The name of the write opt-in variable, and the list of mutations its write guard allows. Export sends `issueLabelCreate`, `projectUpdateCreate`, `commentResolve`, `issueArchive` and, on undo, `issueLabelDelete`. If the guard refuses one of them, the live task asks the user before the guard changes.

It reuses `guardedFetch`-style wrapping from `client-live.mjs` for its read-only steps, and `assertNoKey` for every error.

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| Exports `.issues/` to Linear and imports from Linear into `.issues/` | "Commands", "The snapshot", "Order of writes" (export steps 1 to 8, import order), "History on import", "People", the round-trip test and the live test. |
| Maps IDs and keeps parents, blockers and links | "The ID map" (one entry per record, IDs that round-trip), "Order of writes" (parents first, `parentId` and `projectId`, links after both ends exist), the `links` shape of the snapshot, the round-trip test. |
| Shows the full preview before writing | "The preview" (a line per record, losses, problems, budget, digest), the `--expect` check, "What does not round-trip", and the command procedure that always runs the dry run first. |

## Decisions

1. A shared engine with a reader and a writer per adapter, not a replay through the contract. Reason: it records the UUID before each create and costs a third of the requests.
2. The ID map is a committed YAML file per migration under `.pmkit/migrations/`. Reason: the team needs the old to new IDs after the move, and a rerun from any clone resumes from it.
3. The run writes the map before each mutation and stops at the first failure. Reason: a rerun can then tell, by UUID, what exists.
4. The engine paces itself by stopping at a reserve of 100 requests, not by sleeping. Reason: the window is an hour, and PMK-30 chose never to wait for a reset.
5. Import needs an empty Local tracker and a clean git tree. Reason: git is the undo of an import, and no record collides with an old one.
6. Import keeps Linear history as Local events, reconciled by drift detection. Reason: the reads already bring the history, and metrics need it.
7. An import gives back the Local IDs of records that an earlier export moved. Reason: branch names and commit messages keep working after a round trip.
8. Values Linear lacks are losses and go ahead; values that cannot be mapped are problems and stop the run before any write. Reason: the user sees every loss in the preview, and nothing half-maps.
9. The run checks the plan digest from the preview. Reason: the user approves exactly what runs.
10. `switch` is the only command that changes `tracker.system`. Reason: moving the team is a separate decision from copying the records.
11. Exported comments carry an attribution line, and an import removes it and restores the author. Reason: Linear shows the key owner as the author of every comment.
12. Undo deletes into Linear's trash after a full preview. Reason: it leaves the team as it was, and the live test needs the same code to clean up.
13. Import adds a member for each unmatched Linear user. Reason: assignees, comment authors and history stay correct, and the preview shows the new members first.

## Answers

The user answered the four open questions on 2026-10-28.

1. **Who switches `tracker.system`.** A separate `pmkit local-migrate switch` step, never automatic (option C). See "Switching the tracker".
2. **How exported comments name their author.** Each exported comment starts with an attribution line naming the original author (option A). See "Field by field (export)" and "People".
3. **How a user undoes an export.** `pmkit local-migrate undo` deletes the issues, projects and labels the export created, after a full preview (option A). See "Undo".
4. **Linear users with no Local member on import.** They are added as new members (option A), by the id rule in "People".

The user also changed the live test: one fixed, reusable test team instead of a new team per run. See "Live test".

## Risks

- `createdAt` and `completedAt` on creates are unverified for a personal key. If Linear refuses them, every create fails at the first issue and nothing is half-written. The fix is to drop the two fields, and the losses table then says dates are lost.
- A second create with an existing UUID is assumed to fail in Linear. The resume reads first, so a wrong assumption costs nothing unless the read misses a record that exists.
- `issueDelete` moves an issue to the trash. Whether its links and comments go with it, and how long the trash keeps it, is unverified until the live test.
- The rate-limit response is still unverified live (PMK-30). The reserve stop does not depend on it, since it reads the headers before the limit is reached.
- PMK-39 builds the test-team helper in parallel and merges first. Until the live task runs after that merge, no write to Linear proves this design. Its write guard may refuse the label, update, resolve and archive mutations that export sends.
- The fixed test team is reused. On the Free plan, trashed issues may still count toward the 250-issue limit, which a run of five issues makes slow to reach.
- PMK-40 rewrites `/pmkit:cycle:plan` and `/pmkit:cycle:close` for Linear and may touch the same `run()` checks. The `systems` property is a small, separate change.
- A large Linear team makes the import's first read long: one request per 100 issues plus the nested pages, with no partial snapshot if a read fails. Reads are retried by the client (PMK-30), so a failure stops before any file is written.
- The preview of a large tracker is long. The command shows the summary and the losses first and the record tables after.

## Left to the builder

- The exact shape of `details.problems` and of the per-record `dropped` list, inside the JSON shape above.
- Where the type-label creation and the plain-label creation share code with `requireLabel` in `writes.mjs`.

## Self-review

- Each criterion maps to a part of the design.
- Every step of the export has a request count, and the totals are worked out for pmkit's own tracker.
- Examples use `acme` and `ACME`, and live commands use `$PMKIT_LIVE_WORKSPACE`. The spec names no real workspace, team or project.
- No ADR. The decisions above belong to this issue, and the Local tracker stays the reference.
- The spec stops before the plan, as the issue's step 7 asks.
