# PMK-38 design: map Linear projects to epics

Issue PMK-38, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved, the answers are in "Answered questions". Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0001, ADR-0003, ADR-0005, the PMK-33 and PMK-35 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear tracker answers the Issues and Relations families (PMK-35) and throws `NOT_SUPPORTED` for the rest. The epic commands (`epic list`, `epic get`, `epic progress`, `epic create`, `epic update-status`, `epic updates`), the milestone commands and `docs read` all fail on Linear. Three gaps from PMK-35 also land here:

- `setParent` and the `parent` field of `createIssue` and `updateIssue` refuse an epic id (`NOT_EPICS` in `scripts/lib/linear/writes.mjs`).
- The `milestone` field of an issue is refused (`LATER.milestone` in the same file).
- `settings().isEpicId` is `!isIssueId(id)`, so every non-issue string reaches `getDeliverable`, which is still a stub.

Sources:

- Unified model, "Common entity model": Epic is Project, Milestone is Milestone, Status update is Project update, Document is Document. "Adapter operations contract": the Deliverables and Documents families.
- Linear tab, domain 6 (Projects: status, health, milestones, project updates, linked documents, dependencies between projects) and domain 9 (Documents).
- ADR-0001 (the Local tracker is the reference), ADR-0003 (no dependency), ADR-0005 (the key comes from the environment).
- The PMK-35 spec for the issue fragment, `guarded`, the actor (`viewer.id`) and the fake.
- `scripts/lib/linear/API-VERIFICATION.md` for the rule on features the plan may gate.

Acceptance criteria:

1. Projects are epics, with progress and health.
2. Publishing a status update creates a project update.
3. Project milestones and documents are readable.

Bound decisions from earlier issues:

- The client sends a mutation once and never retries it (PMK-30).
- The actor on Linear is the key owner's `viewer.id`, and every write appears in Linear as that user (ADR-0005, PMK-35).
- The Local tracker is the reference. Its operations define the shapes, and the contract suite checks them (ADR-0001).
- A mapping that names something the workspace lacks stops every operation through `guarded` (PMK-33).

## Facts checked against the Linear API

Read-only calls on 2026-10-28 against the sandbox workspace (Free plan), through `createLinearClient` and a fetch wrapper that refused any document starting with `mutation`. The workspace holds four projects that belong to the user's real work, so this table gives shapes and counts and no names. Introspection reads the schema; it does not prove that a mutation behaves as its input type suggests.

| Call | Result |
|---|---|
| `__type(Project)` | `id`, `slugId`, `identifier`, `previousIdentifiers`, `name`, `description` (short), `content` (long, Markdown), `status` (`ProjectStatus`), `health` (nullable), `healthUpdatedAt`, `progress` (Float), `scope`, `startDate`, `targetDate`, `lead`, `url`, `teams`, `issues`, `projectMilestones`, `documents`, `projectUpdates`, `relations`, `initiatives`. |
| `__type(ProjectStatusType)` | `backlog`, `planned`, `started`, `paused`, `completed`, `canceled`. |
| `projectStatuses(first: 20)` | Five statuses on Free: Backlog, Planned, In Progress, Completed, Canceled. None has the type `paused`. |
| `__type(ProjectUpdateHealthType)` | `onTrack`, `atRisk`, `offTrack`. |
| `__type(ProjectUpdate)` | `id`, `body`, `health` (required), `user`, `project`, `createdAt`, `url`. |
| `__type(ProjectUpdateCreateInput)` | `id` (client-chosen), `projectId` (required), `body`, `health`. |
| `__type(ProjectCreateInput)` | `id` (client-chosen), `name` (required), `teamIds` (required), `content`, `description`, `startDate`, `targetDate`, `statusId`, `leadId`. |
| `__type(ProjectMilestone)` | `id`, `name`, `description`, `targetDate`, `status` (`unstarted`, `next`, `overdue`, `done`), `progress`, `project`. No slug and no short identifier. |
| `__type(Document)` | `id`, `slugId`, `title`, `content` (Markdown), `project`, `initiative`, `team`, `issue`, `url`. |
| `__type(DocumentCreateInput)` | `title` (required), `content`, and one container such as `projectId`. No path. |
| `__type(Mutation)` | `projectCreate`, `projectUpdate`, `projectMilestoneCreate`, `projectUpdateCreate`, `documentCreate`, `projectRelationCreate`, `initiativeCreate` and more. |
| `projects(first: 50)` | Four projects. Every `slugId` has 12 hexadecimal characters. Every `identifier` is set and has the shape letter, hyphen, three letters, hyphen, number. No `previousIdentifiers`. All four have `health: null` and the status type `backlog`. One has milestones, none has documents. |
| `project(id: "<uuid>")`, `project(id: "<slugId>")`, `project(id: "<identifier>")` | All three answer. The identifier answers in lower case too. |
| `projects(filter: { id: { eq: "<identifier>" } })` | One match. The same filter with a `slugId` gives none. `projects(filter: { slugId: { eq } })` gives one. |
| `projects(filter: { accessibleTeams: { some: { key: { eq } } } })` | Answers. |
| `issues(filter: { project: { id: { eq: "<uuid>" } } })` | Answers. |
| `projectMilestones(first: 50)` | Answers, with `project { slugId }`. A `project: { id: { eq } }` filter on `projectMilestones` fails with "Argument Validation Error" when the value is not a real id, so the adapter filters on the client side. |
| `documents(first: 50)`, `documents(filter: { slugId: { eq } })` | Answer. The workspace has no document. |
| `initiatives(first: 5)` | Answers with an empty list on Free. |
| `projectRelations(first: 5)` | Answers with an empty list. |

Consequences for the design:

- A project has three keys, the UUID, the `slugId` and the `identifier`. Only the `identifier` reads like an id, and the API takes all three.
- `Project.progress` and `Project.health` are native fields. No history query is needed for either.
- `health` is `null` until someone publishes a project update. An epic without a health is normal.
- There is no field that links a project to a parent milestone, and a milestone belongs to one project. The Local model, where a milestone is a workspace-wide target, does not fit.
- `Document` has no path. A document is found by its `slugId` or its `id`.
- The sandbox cannot prove any write: its projects are real work. The writes (`projectCreate`, `projectUpdateCreate`) are proven against the fake in `npm test` and against a throwaway project in PMK-39.

## Goals

- `listDeliverables`, `getDeliverable`, `deliverableProgress`, `createDeliverable`, `publishStatusUpdate` and `listStatusUpdates` work on Linear, with the Local shapes and the contract suite's `deliverables` tests passing over the fake.
- A project's epic shape carries its `health` and its `progress`, and `epic get` and `epic list` print them.
- An issue joins an epic through `setParent` and through the `parent` field of `createIssue` and `updateIssue`. `searchIssues` with `parent: <epic id>` returns the epic's direct members.
- `listMilestones`, `getMilestone` and `readDocument` read Linear project milestones and documents. `epic get` lists the milestones and documents of one project.
- `issue.milestone` reads the issue's project milestone.
- `capabilities` states which operations are native, derived or unsupported for the projects entity.

## Non-goals

- Project dependencies (`ProjectRelation`). The contract has no operation for them, and `link` is an issue operation. `issues dependencies` on an epic keeps counting issues only. A follow-up issue can add `epic link` to the contract.
- Initiatives and `strategic_goals`. The contract has no goal operation and `SERVED_BY.strategic_goals` is empty, so the manifest keeps the capability absent with Linear's path in `detail.workspace`.
- `createMilestone` and `createDocument`. See "Operations" and answered question 1.
- Writing `milestone` on an issue. It stays `NOT_SUPPORTED`, with a corrected message.
- Changing a project's status, health or dates from pmkit. The contract has no update operation for epics. Health changes only through a status update.
- Project labels, members, lead, priority, templates, resources and update reminders.
- History and comments of a project (PMK-36) and cycles (PMK-37). This design does not read their code.
- Any write to Linear while this issue is implemented, other than through the fake. The live proof is PMK-39.

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical. New epic keys appear only when the adapter returns them.
- The key in any output, error, cache file or command line (ADR-0005).
- A project name, the real workspace URL key or the real team key in any file. Examples use `acme` and `ACME`.
- A mutation sent twice. The adapter never loops over one.

## Approaches

Two choices shape the work. The first is how an issue belongs to an epic. The second is how a project reaches the epic id.

### How an issue joins an epic

1. **The project shows as the parent.** `Issue.project` is the epic. `getIssue` returns `parent` as the parent issue's identifier when there is one, and the epic id otherwise. `setParent(id, epicId)` sets the project. The Local model, the dependency map and the contract suite already treat an epic as a parent, so no command changes.
2. **A new `epic` field on the issue.** The issue shape gains `epic`, and `issues update --epic` sets it. It is exact, because Linear lets an issue have a parent issue and a project at once. It changes the contract, the Local tracker, `scripts/lib/issue-fields.mjs`, every command that walks `parent` and all goldens. That is a separate issue.
3. **Epics are issues of a type Epic.** It reuses the Issues family. It contradicts the Unified model, which maps Epic to Project, and it loses progress, health and updates.

Chosen: approach 1. It is the only one that leaves the Local tracker and the commands as they are. Its cost is that one field means two things, so "The parent rule" below fixes the behavior.

### How a project gets its epic id

A. **The UUID.** Exact and stable. A person cannot type it or read it in a branch name.
B. **The `slugId`.** Twelve characters, stable, works in `project(id:)`. It reads like noise.
C. **The `identifier`, falling back to the `slugId`.** The `identifier` has a letter prefix and a number, like an issue id, and every project in the sandbox has one. The API takes it in any case. A workspace where `identifier` is null still gets an id.

Chosen: approach C **(builder's call)**. The canonical id is the identifier in upper case, or the `slugId` in lower case when the project has no identifier. Any of the three keys is accepted as input and answers with the canonical id.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/projects.mjs` | New. The GraphQL documents for projects, project updates, milestones and documents. `toEpic`, `toStatusUpdate`, `toMilestone`, `toDocument`, the status and health maps, `epicKey` (classify an input key as identifier, slug or UUID). Pure. |
| `scripts/lib/linear/project-ops.mjs` | New. `projectOperations({ client, discovery, config, now, uuid })` returns the Deliverables, Milestones and Documents operations. |
| `scripts/lib/linear/tracker.mjs` | Adds the new operations to `contract`, so `guarded` wraps them. `createMilestone` and `createDocument` stay stubs with a clearer message. |
| `scripts/lib/linear/documents.mjs` | `ISSUE_FRAGMENT` gains `project { id slugId identifier }` and `projectMilestone { id }`. |
| `scripts/lib/linear/issues.mjs` | `toIssue` sets `parent` by "The parent rule" and `milestone` from `projectMilestone`. |
| `scripts/lib/linear/writes.mjs` | `toInput` accepts an epic id as `parent`. `LATER.milestone` and `NOT_EPICS` change or go. |
| `scripts/lib/linear/relation-ops.mjs` | `setParent` accepts an epic id or null by "The parent rule". |
| `scripts/lib/linear/filter.mjs` | `parent: <epic id>` becomes a project filter plus "no parent issue". |
| `scripts/lib/linear/manifest.mjs` | Adds `detail` to `deliverables`, `status_update` and `documents`. |
| `scripts/lib/linear/adapter.mjs` | Fixes the comment on `isEpicId`. The test `!isIssueId(id)` stays, because no project key has the shape of an issue id. |
| `scripts/lib/format.mjs` | `epicRecord` prints `health` and `progress` when present, plus the `milestones` and `documents` lists. |
| `scripts/pmkit.mjs` | `epic list` adds Health and Progress columns when any epic carries them. |
| `scripts/contract-suite.mjs` | `FAMILIES` gains `milestone-writes` and `document-writes`. The tests that create a milestone or a document need them. |
| `scripts/fake-linear-api.mjs` | Adds `fakeLinearProjects(options)`, a stateful store for projects, updates, milestones and documents, and the `project` fields of the issue store. |
| `scripts/lib/linear/API-VERIFICATION.md` | Records the table above, without project names. |
| Tests | `projects.test.mjs`, `project-ops.test.mjs`, new cases in `tracker.test.mjs`, `manifest.test.mjs`, `filter.test.mjs`, `issues.test.mjs`, `contract.test.mjs`, `fake-linear-api.test.mjs`, the CLI tests for the epic commands, and a live test in `client-live.mjs` that stays skipped without the key. |

The package gains no dependency, and no config schema changes.

### Operations

| Operation | Path on Linear | How |
|---|---|---|
| `listDeliverables` | native | `projects` for the configured team (`accessibleTeams` filter), paginated, sorted by `sortEpics` (start, creation, id) so the order matches Local. |
| `getDeliverable` | native | `projects(filter: { id: { eq } })` for a UUID or identifier, `slugId` filter for a slug. An empty list is `NOT_FOUND`. Adds `milestones` and `documents`. |
| `deliverableProgress` | derived | Counts issues with the Local shape. See "Progress". Adds `native` with Linear's own `progress`. |
| `createDeliverable` | native | `projectCreate` with `name`, `teamIds: [team.id]`, `content`, `startDate`, `targetDate` and a client-chosen `id`. Refuses `milestone` with `NOT_SUPPORTED`, because a project has no parent milestone. |
| `publishStatusUpdate` | native | `projectUpdateCreate` with `projectId`, `body`, mapped `health` and a client-chosen `id`. |
| `listStatusUpdates` | native | `project.projectUpdates`, newest first, mapped to `{ epic, at, author, health, body }` with `author` the user's id. |
| `listMilestones` | native, read only | `projectMilestones` filtered on the client by the team's projects, sorted by `sortMilestones` (due, then id). |
| `getMilestone` | native, read only | `projectMilestone(id)`. A string that is not a UUID is `NOT_FOUND` before a request. |
| `createMilestone` | `NOT_SUPPORTED` | The contract input has no project, and the id is Linear's. Next step: "Create the milestone in Linear". |
| `readDocument` | native, read only | `documents(filter: { slugId: { eq } })`. Returns `{ path: slugId, title, body }`. The path may also be a document URL, and the adapter takes the last 12 characters. |
| `createDocument` | `NOT_SUPPORTED` | A Linear document needs a title and a container, and the contract passes a path. Next step: "Create the document in Linear". |

`guarded` wraps every operation, so the workspace check and the mapping check run first.

### Epic shape

`toEpic(node)` returns the Local shape, `{ id, title, status, start, target, description }`, plus three optional keys.

- `status` is `{ name, category }`. `name` is the project status name. `category` comes from the status type: `backlog` to `backlog`, `planned` to `todo`, `started` to `in_progress`, `completed` to `done`, `canceled` to `canceled`, `paused` to `backlog` (answered question 3). The map is fixed and needs no mapping question.
- `start` and `target` come from `startDate` and `targetDate`. A null stays out.
- `description` is `content` when it is set, else `description`.
- `health` is `on_track`, `at_risk` or `off_track`, and the key is absent when Linear's is null.
- `progress` is Linear's `Project.progress`, a number from 0 to 1.
- `url` is the project's web address.
- `getDeliverable` adds `milestones`, a list of `{ id, name, due, status }`, and `documents`, a list of `{ path, title }`. Both are read in the same request, 50 each, and a longer list sets `milestonesMore` or `documentsMore` to true.

The Local epic has none of `health`, `progress`, `url`, `milestones` and `documents`. The contract suite accepts extra keys on an epic. `epicRecord` and `epic list` print a key only when it exists, so Local output does not change.

### The parent rule

An issue has an optional parent issue and an optional project. pmkit has one `parent`. The rule is:

- `getIssue` and `searchIssues` return `parent` as the parent issue's identifier when it exists. Otherwise they return the project's canonical id. They return no `parent` when neither exists.
- `setParent(id, <issue id>)` sets `parentId` and leaves the project as it is.
- `setParent(id, <epic id>)` sets `projectId` and clears `parentId`, so `parent` reads back as the epic.
- `setParent(id, null)` clears both `parentId` and `projectId` (answered question 2).
- `createIssue` and `updateIssue` with `parent` do the same as `setParent`.
- An id that is neither a known issue nor a known project is `INVALID_INPUT`, with the message "parent X is not an existing issue or epic".
- `searchIssues` with `parent: <epic id>` sends `project: { id: { eq } }` together with `parent: { null: true }`, so it returns the issues whose shown parent is that epic and no others. The adapter resolves the project's UUID first.

The dependency map and `epic progress` follow `parent` upward, so a sub-issue of an issue in the epic reaches the epic through its parent's `parent`. This matches Local.

### Progress

`deliverableProgress` returns the Local shape: `total`, `done`, `canceled`, `points`, `pointsDone` and `byCategory`. It reads the issues whose parent chain reaches the epic, the same rule as Local.

1. Read the issues with `project: { id: { eq } }`, paginated, with the minimal fields (identifier, state type, estimate, archived).
2. Read the descendants level by level with `parent: { id: { in } }`, up to `PARENT_CHAIN_DEPTH` (10) levels. Skip identifiers already seen.
3. Drop archived issues. Count with the Local rules: canceled issues add to `canceled` and not to `total`, estimates add to `points`.
4. Add `native: { progress, scope }` from the project, so a reader sees Linear's own number beside the count.

The two numbers can differ. Linear weights by estimate, and it ignores sub-issues outside the project. The count is the number the commands use. A page cap of 10 pages for the first step sets `hasMore: true` in the result and a warning from the command.

### Status updates

`publishStatusUpdate({ epic, health, body }, actor, { dryRun })` checks `health` against `HEALTH` and the body for text, the same checks as Local. It resolves the project (so an unknown id is `NOT_FOUND` before any write), then sends `projectUpdateCreate` once with a client-chosen id.

A timeout after the send is checked by reading the update by that id, as `createIssue` does (PMK-35). A dry run sends nothing and returns `{ before: null, after }` with `at` set to the clock's time and `author` to the actor.

The update changes the project's `health`, so the next `getDeliverable` shows it. The contract test expects two updates in the same second to list newest first. Linear orders by creation time with a stable tie-break on the id, and the fake does the same.

### Milestones and documents

A milestone's id is its UUID. Linear has nothing shorter. `epic get` prints the ids, so a person reaches `milestone get <id>` from there. `listMilestones` returns `{ id, name, due, description, epic, status, progress }`, where `epic` is the project's canonical id. Local milestones have no `epic`, `status` or `progress`, and the milestone commands print only the Local keys. The extra keys reach `--json`.

`issue.milestone` is the id of `projectMilestone`. Writing it stays `NOT_SUPPORTED`, with the message "set the milestone in Linear" (answered question 1).

A document's path is its `slugId`. `docs read <slugId>` prints the content. `epic get` lists the project's documents with their paths. A document that belongs to no project is readable by `slugId` as well, and nothing lists it.

### Manifest

The manifest reports capabilities, so it carries the three project capabilities and their limits in `detail`.

| Capability | Path | Detail |
|---|---|---|
| `deliverables` | native | `{ entity: 'project', derived: ['deliverableProgress'], unsupported: ['createMilestone'] }` |
| `status_update` | native | `{ entity: 'project update' }` |
| `documents` | native | `{ scope: 'project', unsupported: ['createDocument'] }` |
| `strategic_goals` | absent | unchanged, with Linear's path in `detail.workspace` |
| `dependencies` | native | unchanged. It covers issue relations. Project dependencies are a non-goal. |

The text printer already joins `detail` pairs, so `capabilities` shows the lists with no change. The sandbox answers `initiatives` on Free with an empty list while `workspaceAnswers` marks `strategic_goals` absent for a non-Business plan. The manifest follows the documented plan rule, because the API answering says nothing about whether Free can create one. PMK-39 can check it.

### The contract suite

`runTrackerContract` already skips a test whose family the adapter lacks. This design adds `milestone-writes` and `document-writes` to `FAMILIES`, tags the tests that create a milestone or a document with them, and leaves the empty-list and NOT_FOUND tests under `milestones` and `documents`. The Linear contract lists `discovery`, `issues`, `relations`, `deliverables`, `milestones` and `documents`. Local lists everything by default, so its suite does not change.

The Linear milestone and document reads are proven in `project-ops.test.mjs` against the fake with seeded data, because the neutral suite cannot seed a project.

## Tests

- Pure mappers in `projects.test.mjs`: every project status type, every health value, an epic with and without identifier, health and dates, a status update, a milestone, a document, and `epicKey` for an identifier, a slug, a UUID and garbage.
- `project-ops.test.mjs` over the fake: list and get with the three key forms, `NOT_FOUND`, progress against an issue tree that includes a sub-issue and an archived issue, create with a dry run, a publish that changes health, listing order, and the reads of milestones and documents.
- The parent rule in `tracker.test.mjs` and `relation-ops` cases: set an epic, set an issue, replace one with the other, clear, the unknown id, and the `parent` filter.
- Manifest cases for the three `detail` values.
- CLI cases for `epic list` and `epic get` over the fake, with health and progress printed.
- A check that no Local golden changed, which `npm test` already runs.
- No test sends a request to Linear. The live test in `client-live.mjs` runs only with the key and reads projects, milestones and documents.

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| Projects are epics, with progress and health | "Operations" rows `listDeliverables`, `getDeliverable`, `deliverableProgress` and `createDeliverable`. "Epic shape" for `health` and `progress`. "The parent rule" for how an issue joins an epic. "Progress" for the count. |
| Publishing a status update creates a project update | "Status updates" and the `publishStatusUpdate` and `listStatusUpdates` rows. The `deliverables` contract tests over the fake. |
| Project milestones and documents are readable | "Milestones and documents", the rows `listMilestones`, `getMilestone` and `readDocument`, `issue.milestone`, and the `milestones` and `documents` lists of `epic get`. |

## Decisions

1. An issue joins an epic through `parent`, with the project shown as the parent when no parent issue exists. Reason: no command, golden or contract operation changes.
2. The epic id is the project `identifier` in upper case, else the `slugId`. Any of the three keys is accepted. Reason: it reads like an issue id and every key resolves.
3. `isEpicId` stays `!isIssueId`. Reason: an identifier has two hyphens or none, a slug has none, and neither matches the issue pattern.
4. `deliverableProgress` counts issues in the Local shape and adds Linear's own number. Reason: the commands and the dependency map need the same shape on every tracker.
5. `listDeliverables` and `listMilestones` cover the configured team's projects. Reason: `tracker.scope.team` is required by `guarded`, and the other commands already stay inside that team.
6. `createDeliverable` refuses `milestone`. Reason: a project has no parent milestone.
7. Milestone ids are UUIDs and document paths are slugs. Reason: Linear has nothing shorter for a milestone, and `Document` has no path.
8. The manifest reports limits in `detail` lists. Reason: the capability ids are fixed at 20, and `detail` is free-form.

## Answered questions

1. Milestones and documents are read only in this issue. `createMilestone` and `createDocument` return `NOT_SUPPORTED`, and the manifest `detail` says so. Writes are a follow-up issue (option C).
2. `setParent(id, null)` clears both the parent issue and the project (option A).
3. A paused project maps to `backlog` (option A).
4. `epic list` is scoped to the configured team (option A).

## Risks

- PMK-36 and PMK-37 also edit `ISSUE_FRAGMENT` (history needs events, cycles need `cycle`). The three issues merge into one fragment, so expect a textual conflict in `documents.mjs` and in the fake's `toNode`.
- The `identifier` of a project may be null in a workspace where the feature is off, and the sandbox cannot show that. The `slugId` fallback covers it, and the fake has a test for it.
- A project created by `projectCreate` may get its `identifier` after the request. The adapter reads the project back before it returns, so `after.id` is the canonical id.
- Free may refuse `projectUpdateCreate` or `projectCreate`. The fake cannot show that, and PMK-39 checks it on a throwaway project. A refusal reaches the command as `UPSTREAM` with Linear's message.
- `Project.progress` is weighted by estimate when the team uses estimates, so it can differ from the count. The output labels both.
- A sub-issue outside the project reaches the epic only through its parent issue. An orphan in neither place is not in the epic.

## Self-review

- The three criteria each map to a part of the design.
- No operation is left without a path. Two are `NOT_SUPPORTED` on purpose, and the manifest says so.
- Examples use `acme` and `ACME`, and no project name, workspace key or team key appears.
- The spec adds no ADR. The id form and the parent rule are decisions of this issue, and the Local tracker stays the reference.
