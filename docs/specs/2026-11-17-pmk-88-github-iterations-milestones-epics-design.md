# PMK-88 design: iterations, milestones, epics and status updates for GitHub Issues

Issue PMK-88, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: waiting for the user's approval. The user answered four questions on 2026-11-16 and 2026-11-17, and "Decisions from the user" records the answers. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub tracker implements the Issues, Relations, History and Comments families (PMK-87). Every operation of the Cycles, Capacity, Deliverables and Milestones families is still a stub that answers `NOT_SUPPORTED` (`scripts/lib/github/tracker.mjs`). Three places refuse on purpose and name this issue:

- `translateFilter` in `scripts/lib/github/filter.mjs` throws on `filter.sprint` (and has no milestone clause).
- `planWrite` in `scripts/lib/github/writes.mjs` refuses a `sprint` or `milestone` value on create and update.
- `buildGithubCapabilities` in `scripts/lib/github/manifest.mjs` reports `cycles`, `capacity`, `deliverables` and `status_update` absent with the hint "does not serve ... yet (EPC-8)".

So `/pmkit:cycle:plan`, `/pmkit:cycle:close`, the `epic` commands and the `milestone` commands cannot run on a GitHub repository.

Acceptance criteria:

1. The iteration field maps to sprints when the project has one.
2. Projects or milestones map to epics, with status updates.

Source: Unified model, Capabilities (`cycles`: Conditional, iteration field; `deliverables`: project or milestone; `status_update`: Native).

## Decisions already made

ADR 0007, ADR 0008 and the PMK-84 to PMK-87 specs settle these, and this spec does not reopen them:

- Every call goes through `createGithubClient` with `tracker.scope.host`. pmkit holds no token. The client sends a mutation once and never retries it.
- `tracker.scope.project` (`owner/number` or `none`) is the Status board. Its single-select Status field plus open or closed gives the status category.
- `mappings.fields.<role>` holds `issue:<name>`, `project:<name>` or `none`.
- Every operation but `discover` and `capabilities` runs through `guarded`: the scope check, then the mapping check.
- An issue id is its number for the scope repository, else `owner/name#number`. `isEpicId` is `!isIssueId`.
- The minimum GHES version is 3.19. `needsVersionCheck(host)` is true for GHES.
- Capacity on a hosted tracker without a native field lives in the committed `.pmkit/capacity.yaml`, with the Local validators (PMK-37).

## Decisions from the user

1. **Epics are Projects.** An epic is a GitHub Project linked to the repository, other than `tracker.scope.project`. The epic id is `owner/number`, such as `acme/12`. An issue belongs to an epic when it is an item of that Project. `setParent(issue, 'acme/12')` adds it, and `setParent(issue, null)` removes it. `issue.parent` reads the parent issue first, then the epic Project. `epic create` runs `createProjectV2` under the repository owner, linked to the repository. `publishStatusUpdate` sends `createProjectV2StatusUpdate`, and `on_track`, `at_risk` and `off_track` map 1:1 to `ON_TRACK`, `AT_RISK` and `OFF_TRACK`. GitHub milestones map 1:1 to pmkit milestones. PMK-89 may add a milestone fallback for epics in repositories without Projects.
2. **Opening and closing sprints.** `openCycle` is native on github.com and GHE.com: it reads the iteration field's configuration, appends one iteration and sends every existing iteration back with its id, so no item loses its iteration. On GHES it answers `NOT_SUPPORTED` with the next step `Add the iteration in the Project settings on GitHub`. `closeCycle` answers `NOT_SUPPORTED` everywhere, because GitHub ends an iteration on its end date. `/pmkit:cycle:close` still moves unfinished issues with `moveToCycle`. Accepted calls: the sprint id is the iteration's start date (`YYYY-MM-DD`); setup asks for `mappings.fields.sprint` as `project:<iteration field name>` or `none`, and `cycles` is absent when it is `none`; capacity and days off live in `.pmkit/capacity.yaml`; a sprint `goal` answers `NOT_SUPPORTED`.
3. **Milestones.** A milestone's id is its GitHub title, and its name is the title too. Its description is GitHub's description. `milestone create <id>` sends the REST call `POST repos/{owner}/{repo}/milestones` through `gh` with `title` = id and the due date. A `--name` that differs from the id fails with `INVALID_INPUT`, `a GitHub milestone has one name, its title`. `issues create` and `issues update` set and clear an issue's milestone natively, and the milestone filter works. Accepted calls: list and get cover open and closed milestones, and a closed one carries `status: closed`; a title with spaces is a valid id when read.
4. **Epic dates.** An epic's `start` and `target` come from its latest status update. `epic create` with `--start` or `--target` creates the Project, then publishes a first status update with status `INACTIVE` and those dates. `epic update-status` copies the latest update's dates into the new update, so they never drop. Accepted calls: an epic's status is `done` when the Project is closed or its latest update is `COMPLETE`, `backlog` when it is `INACTIVE`, `in_progress` when it is `ON_TRACK`, `AT_RISK` or `OFF_TRACK`, and `todo` with no update. Health comes from the latest update and is absent for `INACTIVE`, `COMPLETE` or no update. The description is the Project's readme. `--milestone` and `--goal` on `epic create` answer `NOT_SUPPORTED`, because a Project has neither. An issue in two epic Projects shows the lower Project number as its parent, and `setParent` to an epic removes the issue from any other epic Project.

## Facts checked against GitHub

Read-only GraphQL introspection on github.com on 2026-11-17, and the GHES 3.19, 3.20 and 3.21 schemas that `github/docs` publishes (`src/graphql/data/ghes-<version>/schema.docs-enterprise.graphql`). No write was sent.

| Fact | github.com, GHE.com | GHES 3.19 to 3.21 |
|---|---|---|
| `updateProjectV2Field(input: { fieldId, iterationConfiguration })` exists. "Provided values overwrite the existing configuration, and existing configuration should be fetched for partial updates." | yes | yes |
| `ProjectV2IterationFieldConfigurationInput` has `startDate`, `duration` and `iterations`. | yes | yes |
| `ProjectV2Iteration` (input) has `id`: "Include this to preserve the iteration's identity during replacement updates." | yes | no, only `startDate`, `duration`, `title` |
| `ProjectV2IterationFieldConfiguration` has `iterations`, `completedIterations`, `duration` and `startDay`. Each iteration has `id`, `title`, `startDate` and `duration` (days). | yes | yes |
| `ProjectV2ItemFieldIterationValue` has `iterationId`, `title`, `startDate` and `duration`. | yes | yes |
| `ProjectV2.items` takes `query`. | yes | no |
| `createProjectV2(input: { ownerId, title, repositoryId, teamId })`. | yes | yes |
| `createProjectV2StatusUpdate(input: { projectId, status, body, startDate, targetDate })`. `ProjectV2StatusUpdateStatus` is `INACTIVE`, `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `COMPLETE`. | yes | yes |
| `ProjectV2StatusUpdate` has `body`, `status`, `startDate`, `targetDate`, `creator`, `createdAt`. | yes | yes |
| `ProjectV2` has `title`, `shortDescription`, `readme`, `closed`, `url`, `statusUpdates`, `items`, `number`, `owner`, `repositories`. No dates. | yes | yes |
| The Mutation type has no milestone mutation. Only REST creates a milestone. `createIssue` and `updateIssue` take `milestoneId`. | yes | yes |

Consequences:

- An `openCycle` on GHES would recreate every iteration under a new identity and clear the iteration of every item. Decision 2 refuses it there.
- `iterations` in the update must hold the completed iterations too, or GitHub deletes them. The adapter sends `completedIterations` and `iterations` together, in date order.
- The `iterationConfiguration` behaviour (that sending every id keeps every item's value) comes from the schema description only. The fake follows it, and "Risks" lists the live check.

## Goals

- The Cycles family on the iteration field that `mappings.fields.sprint` names, with capacity in `.pmkit/capacity.yaml`.
- The Deliverables family on linked Projects, with status updates through Project status updates.
- The Milestones family on repository milestones, and the issue's `sprint` and `milestone` read, written and filtered.
- Manifest entries for `cycles`, `capacity`, `deliverables` and `status_update` that tell a skill what works on this host.

## Non-goals

- Releases. `release` writes and the Releases family stay `NOT_SUPPORTED` (a later EPC-8 issue).
- Epics or milestones without a Project, and labels for statuses (PMK-89).
- Sprint changes in `getHistory`. GitHub's issue timeline has no iteration event, so history shows none. Milestone changes do appear (see "History").
- Strategic goals, documents, saved views, customers, time tracking.
- `items(query:)` on github.com. One code path serves every host (see "Approaches").

## Anti-goals

- A write that clears the iteration of items the user did not ask to move.
- A status update that drops the dates GitHub shows on the Project.
- Any change to Local or Linear output.

## Approaches

### How an issue finds its sprint

- A. Read the iteration value of the issue's item in the scope Project as part of the issue fragment, and run `sprint` as a client step of `searchIssues`; `cycleIssues(id)` is `searchIssues({ sprint: id })`. **Chosen (builder's call).** One code path on every host, and `getIssue` shows `sprint` with no extra request.
- B. Page the scope Project's items with `items(query: "iteration:...")` for `cycleIssues`. Rejected for now: GHES has no `query` argument, so it needs a second path, and the issue fragment still needs the value for `getIssue`.

### How the adapter knows which Projects are epics

- A. Read the repository's linked Projects (`LINKED_PROJECTS_QUERY`, raised to page) once per run, outside the discovery cache, and compare each issue item's Project with that list. **Chosen (builder's call).** `epic create` adds a Project that the next run sees at once, and the hour-long discovery cache never hides a new epic.
- B. Keep the list in the discovery cache. Rejected: a new epic would stay invisible for up to an hour.

### Approaches settled by the user

Questions 1 to 4 chose among named options, and "Decisions from the user" records each pick. The options left out were: a Project field or milestones as epics (question 1); open and close both refused, or open everywhere (question 2); the milestone number as id, or read-only milestones (question 3); create refusing dates, or no dates at all (question 4).

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/github/cycles.mjs` | New, pure. `toSprint(iteration, state, capacityEntry)`, `iterationState(iteration, completed, today)`, `iterationEnd`, `appendIteration(config, { start, end, name })` (the `iterationConfiguration` to send), the GraphQL documents of the iteration field. |
| `scripts/lib/github/cycle-ops.mjs` | New. `cycleOperations({ client, ops, config, getContext, now })`: `listCycles`, `currentCycle`, `cycleIssues`, `openCycle`, `closeCycle`, `moveToCycle`, `getCapacity`, `setCapacity`, `getDaysOff`, `updateCycleCapacity`. |
| `scripts/lib/github/projects.mjs` | New, pure. `toEpic(project, latestUpdate)`, `toStatusUpdate(node, epicId)`, `toMilestone(node)`, the status and health maps, `parseEpicId`, the GraphQL documents of Projects and status updates. |
| `scripts/lib/github/project-ops.mjs` | New. `projectOperations(...)`: `listDeliverables`, `getDeliverable`, `deliverableProgress`, `createDeliverable`, `publishStatusUpdate`, `listStatusUpdates`, `listMilestones`, `getMilestone`, `createMilestone`, and `epicProjects()` (the linked Projects of this run). |
| `scripts/lib/github/client.mjs` | Adds `rest(method, path, body)`, which runs `gh api --hostname <host> --method <m> <path> --input -` through the same runner and error mapping. Only `createMilestone` uses it. |
| `scripts/lib/github/documents.mjs` | The item selection gains `project { id number owner { login } }` and, when `mappings.fields.sprint` is set, `sprint: fieldValueByName(name: $fSprint)` on `ProjectV2ItemFieldIterationValue`. The issue fragment gains `milestone { id number title }`. The timeline gains `MILESTONED_EVENT` and `DEMILESTONED_EVENT`. |
| `scripts/lib/github/issues.mjs` | `toIssue` sets `sprint` (the start date of the item's iteration in the scope Project), `milestone` (the title) and `parent` by "The parent rule". |
| `scripts/lib/github/writes.mjs` | `sprint` and `milestone` stop being refused. `milestone` resolves to `milestoneId`; `sprint` becomes an item field write like Status. `release` stays refused. |
| `scripts/lib/github/filter.mjs` | `milestone` becomes `filterBy.milestoneNumber` on the server (`none` is `"none"`). `sprint` (`current`, a start date, `none`) and `parent: <epic id>` become client steps. |
| `scripts/lib/github/relation-ops.mjs` | `setParent` takes an epic id or null by "The parent rule". |
| `scripts/lib/github/history.mjs` | Milestone events become `{ op: 'update', field: 'milestone', from, to }`. |
| `scripts/lib/github/mappings.mjs` | `FIELD_ROLES` gains `sprint`, Project fields only, of type `ITERATION`. Setup recommends a field named `Iteration` or `Sprint`. |
| `scripts/lib/github/discovery.mjs` | The repository query reads `owner { id }`. The Project query reads the iteration field's configuration (`configuration { duration startDay iterations { id title startDate duration } completedIterations { ... } }`). |
| `scripts/lib/github/manifest.mjs` | The four entries in "Manifest". |
| `scripts/lib/github/tracker.mjs` | Wires the new operations into `contract`, so `guarded` wraps them. |
| `scripts/lib/linear/capacity-store.mjs` | The entry sort compares ids as text when they are dates, so GitHub can reuse the store. No other change. |
| `scripts/fake-github-issues.mjs` | The stateful fake gains an iteration field, linked Projects with items, status updates, milestones (GraphQL reads and the REST create), and the new mutations. |
| `scripts/lib/github/contract.test.mjs` | Lists `cycles`, `deliverables`, `milestones` and `milestone-writes`, with a cycle provider. |
| Runbooks | New `docs/runbooks/cycles-epics-github.md` with `scripts/runbook-cycles-epics-github.test.mjs`; `setup-github.md` and its test gain the sprint question. |
| Docs | README (GitHub section), the changelog, the `settings` typedef if it lists GitHub limits, ADR 0010. |

No dependency is added, and the config schema gains only the `sprint` field role.

### Config and setup

`mappings.fields.sprint: project:<name>|none`. The mapping check reports a held name that the scope Project no longer has, or a field that is not an iteration field. Setup asks the question only when `tracker.scope.project` is set, and offers the Project's iteration fields, then `none`. With `tracker.scope.project: none`, `sprint` is `none` and `cycles` is absent.

### Sprints

| Operation | How |
|---|---|
| `listCycles({ state })` | The iteration field's `completedIterations` and `iterations` from a fresh read of the field (not the discovery cache, so a new iteration shows at once), in start-date order. |
| `currentCycle()` | The `active` sprint, or null. |
| `cycleIssues(id)` | `searchIssues({ sprint: id })`. An unknown id is an empty list, as on Linear. |
| `openCycle(input, actor, { dryRun })` | See below. |
| `closeCycle` | `NOT_SUPPORTED`, `GitHub ends an iteration on its end date`, next step `pmkit cycle add <ids> --to <next sprint>` to move the unfinished issues. |
| `moveToCycle(ids, to, actor, { dryRun })` | Checks every issue and the target first. For each issue: adds its item to the scope Project when missing (`addProjectV2ItemById`, as `moveToCategory` does), then `updateProjectV2ItemFieldValue` with `{ iterationId }`, or `clearProjectV2ItemFieldValue` for `to: null`. A closed sprint is refused as on Local. A failure midway lists the issues already moved. |
| Capacity family | `.pmkit/capacity.yaml` through the Linear capacity store, keyed by the scope Project `owner/number`, sprint ids as dates. |

Sprint shape: `{ id: startDate, name: title, start: startDate, end: startDate + duration - 1, goal: '', state, capacity, daysOff }`. `state` is `closed` for a completed iteration, `active` when `start <= today <= end`, else `planned`. `today` is the UTC date of the tracker's clock **(builder's call)**. Two iterations with the same start date: the first in GitHub's order wins and `listCycles` adds a warning **(builder's call)**.

`openCycle({ start, end, name, goal })`:

1. `goal` set answers `NOT_SUPPORTED`, `a GitHub iteration has no goal`.
2. On GHES it answers `NOT_SUPPORTED` with `Add the iteration in the Project settings on GitHub`.
3. `start` must be a date. `end` defaults to `start + field duration - 1`. `name` defaults to `Sprint <start>`, as on Local. A start date that exists, or a range that overlaps a sprint that is not closed, is `INVALID_INPUT`, as on Local.
4. It sends one `updateProjectV2Field` with `iterationConfiguration: { startDate: <first iteration's start>, duration: <field duration>, iterations: [every completed and current iteration with id, title, startDate, duration, plus the new one] }`.
5. It reads the field back and returns `{ before: null, after: <the new sprint> }`. A dry run sends nothing.

The manifest's `detail.open` tells a skill whether this works before it calls.

### Milestones

| Operation | How |
|---|---|
| `listMilestones()` | `repository.milestones(states: [OPEN, CLOSED])`, paged, sorted by `sortMilestones` (due, then id). |
| `getMilestone(id)` | The milestone whose title equals the id (GitHub titles are unique per repository; the comparison is exact). Else `NOT_FOUND`. |
| `createMilestone({ id, name, due })` | `name` set and different from `id` is `INVALID_INPUT`. An existing title is `CONFLICT`. Otherwise `client.rest('POST', 'repos/<owner>/<name>/milestones', { title: id, due_on: '<due>T00:00:00Z' })`, then a read back. A dry run sends nothing. |

Milestone shape: `{ id: title, name: title, due, description, status: 'open'|'closed' }`, with `due` the date part of `dueOn`. Local milestones have no `description` or `status`; the milestone commands print only the Local keys, and the extra keys reach `--json`.

`issue.milestone` is the title. A write resolves the title to its node id from the milestone list and sends `milestoneId` (null clears it). An unknown title is `INVALID_INPUT` with the next step `pmkit milestone create <id>`.

### Epics

Epic projects are the Projects linked to the scope repository, minus `tracker.scope.project`, read once per run by `epicProjects()`.

| Operation | How |
|---|---|
| `listDeliverables()` | Each epic Project with its latest status update (`statusUpdates(first: 1, orderBy: { field: CREATED_AT, direction: DESC })`), sorted as Local sorts epics (start, then id). Closed Projects are included and read as `done`. |
| `getDeliverable(id)` | `parseEpicId(id)` (`owner/number`, compared without case), then the Project by owner and number. A Project that is not linked to the repository, or is the scope Project, is `NOT_FOUND` with the next step `pmkit epic list`. |
| `deliverableProgress(id)` | The Local shape (`total`, `done`, `canceled`, `points`, `pointsDone`, `byCategory`). It reads the Project's issue items (scope repository and others), then their sub-issues level by level up to 10 levels, drops archived ones, and counts with the Local rules. More than 10 pages of items sets `hasMore: true`. |
| `createDeliverable({ title, start, target, description, milestone, goal })` | `milestone` or `goal` answers `NOT_SUPPORTED`. It sends `createProjectV2 { ownerId: <repository owner>, title, repositoryId }`, then `updateProjectV2 { readme: description }` when a description is set, then `createProjectV2StatusUpdate { status: INACTIVE, startDate, targetDate }` when a date is set. A failure after the first write names the Project made and what is missing. Returns the epic read back. |
| `publishStatusUpdate({ epic, health, body })` | Checks `health` and `body` as Local does, resolves the epic (`NOT_FOUND` before any write), reads the latest update, and sends `createProjectV2StatusUpdate { status: <health upper case>, body, startDate, targetDate }` with the dates of the latest update. |
| `listStatusUpdates(id)` | `statusUpdates`, newest first, as `{ epic, at: createdAt, author: creator.login, health, body }`. An `INACTIVE` or `COMPLETE` update has no `health` and carries `status: 'inactive'|'complete'` **(builder's call)**; the printer shows `-` for a missing health. |

Epic shape: `{ id: 'owner/number', title, status: { name, category }, start, target, description, health, url }`. `status.name` is `Closed`, or the latest update's status in sentence case (`On track`, `Inactive`), or `No update` **(builder's call)**. `start` and `target` come from the latest update and stay out when null. `description` is the readme, else the short description.

### The parent rule

- `getIssue` and `searchIssues` return the parent issue's id when it exists. Otherwise they return the id of the epic Project the issue's item belongs to, the lowest Project number when there are several. Items in Projects that are not epic Projects are ignored.
- `setParent(id, <issue id>)` works as in PMK-87 and leaves epic Project items alone.
- `setParent(id, <epic id>)` removes the parent issue (`removeSubIssue`) when there is one, adds the issue to the epic Project (`addProjectV2ItemById`), and deletes its items in any other epic Project (`deleteProjectV2Item`), so `parent` reads back as that epic.
- `setParent(id, null)` removes the parent issue when there is one, else deletes the issue's items in every epic Project.
- `createIssue` with an epic `parent` adds the item after the create. `updateIssue` refuses `parent`, as today.
- `searchIssues({ parent: <epic id> })` is a client step on the shown parent.
- An id that is neither an issue nor an epic is `INVALID_INPUT`, `parent X is not an existing issue or epic`.

The scope Project's item is never touched by a parent write, so the status stays as it was.

### History

`MILESTONED_EVENT` and `DEMILESTONED_EVENT` become milestone updates, with `from` and `to` as titles. Iteration changes have no timeline event, so `getHistory` shows none, and the manifest's `cycles.detail` says `history: false` **(builder's call)**.

### Manifest

| Capability | Path | Detail |
|---|---|---|
| `cycles` | native when `mappings.fields.sprint` names an iteration field of the scope Project, else absent with `Map an iteration field of the Project with /pmkit:setup` | `{ field, open: <not GHES>, close: false, schedule: 'project', history: false }` |
| `capacity` | derived when `cycles` is native, else absent with `Capacity needs cycles` | `{ source: 'local', file: '.pmkit/capacity.yaml' }` |
| `deliverables` | native when `tracker.scope.project` is set, else absent with `Set tracker.scope.project with /pmkit:setup` (PMK-89 may change this) | `{ entity: 'project', derived: ['deliverableProgress'], milestones: 'repository' }` |
| `status_update` | native under the same condition | `{ entity: 'project status update' }` |

Epics need the `project` scope that the scope Project already needs (ADR 0007), so tying them to `tracker.scope.project` asks no user for a new scope **(builder's call)**.

### The contract suite

`scripts/lib/github/contract.test.mjs` adds `cycles`, `deliverables`, `milestones` and `milestone-writes` to the families, and a cycle provider over a fake Project with an iteration field whose current iteration covers the suite's `today`. `cycle-lifecycle` stays off because `closeCycle` is refused; `openCycle` and the GHES refusal are proven in `cycle-ops.test.mjs`.

## Tests

- Pure: `cycles.test.mjs` (state by date, end date, `appendIteration` keeps ids and completed iterations, duplicate start dates), `projects.test.mjs` (every status update status, health, dates, the epic id parse, a milestone).
- `cycle-ops.test.mjs` and `project-ops.test.mjs` over the fake: every row of the tables above, dry runs, the GHES refusals, the three-write create and its failure after the first write, and dates carried forward.
- `relation-ops.test.mjs`, `filter.test.mjs`, `writes.test.mjs`, `issues.test.mjs`, `history.test.mjs`, `manifest.test.mjs`, `mappings.test.mjs` for the parts each file changes.
- The contract suite with the new families.
- CLI cases for `cycle list`, `cycle add`, `epic list`, `epic get`, `epic create`, `epic update-status`, `milestone list` and `milestone create` over the fake.
- The two runbook E2E tests.
- No test reaches GitHub.

## Acceptance criteria map

| Criterion | Part of the design |
|---|---|
| The iteration field maps to sprints when the project has one | "Config and setup", "Sprints", the `cycles` and `capacity` manifest rows, the `sprint` read, write and filter. |
| Projects or milestones map to epics, with status updates | "Epics", "The parent rule", "Milestones", the `deliverables` and `status_update` manifest rows. |

## Builder's calls

1. The iteration value and the epic membership come from the issue fragment, and `cycleIssues` is a filtered search (approach A).
2. The linked Projects are read once per run, outside the discovery cache.
3. `today` for a sprint's state is the UTC date of the tracker's clock.
4. Duplicate iteration start dates: the first wins, with a warning.
5. `INACTIVE` and `COMPLETE` updates list with `status` and no `health`.
6. An epic's `status.name` is `Closed`, the latest update's status, or `No update`.
7. `deliverables` and `status_update` are native only when `tracker.scope.project` is set.
8. Sprint changes are absent from history, and the manifest says `history: false`.
9. The Linear capacity store is reused with a text sort for date ids, not moved.
10. The client gains one `rest` method, used only by `createMilestone`.

## Risks

- `openCycle` relies on the schema's description that ids keep identity in a replacement. The fake implements that rule. A live check on a throwaway Project on github.com (one `openCycle`, then a read of an item's iteration) is a manual step in the new runbook; it needs a Project the user owns, so the plan does not run it.
- The sprint filter scans the repository's issues on the client. A large repository makes `cycle issues` slow. `items(query:)` on github.com could replace it later.
- `createDeliverable` sends up to three mutations, and the client never retries, so a failure can leave a Project without its readme or dates. The error names the Project and the step to finish by hand.
- An issue item can sit in an epic Project of another repository's link set; only Projects linked to the scope repository count.
- PMK-89 runs in parallel and edits `manifest.mjs`, `documents.mjs`, `discovery.mjs` and `mappings.mjs`. Changes here stay additive in those files.
- `epicProjects()` reads up to 10 pages of 20 linked Projects. A repository with more sets a warning.
