# PMK-79: Map Jira epics, versions and status updates

Issue PMK-79, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Acceptance criteria: "Epics are epics, versions are releases" and "A status update goes to Home, or to a comment when Home is not available". Written on 2026-11-23 by a dispatched worker with no live user dialogue, from the issue, ADR 0013 to 0016, the PMK-76, PMK-77 and PMK-78 specs, the GitHub (PMK-88, ADR 0010, 0011) and Linear (PMK-38, PMK-246, PMK-261) epic and release code, and the code. Calls marked **(builder's call)** change no acceptance criterion; the owner can override any of them. Status: approved by the owner (Orca coordinator) on 2026-11-23, with yes to Q1 to Q4 in "Interview answers". No Jira credentials exist, so nothing here was checked against a live site.

## Intent

After PMK-78 a Jira repository reads and writes work items and sprints, but every Deliverables, Releases and Milestones operation is a `NOT_SUPPORTED` stub, an issue's `release` and `milestone` writes and the `release` filter refuse naming PMK-79, and the manifest reports `deliverables`, `status_update` and `releases` absent (naming PMK-79). So `/pmkit:report:status`, `epic list|get|create|move|update|progress`, `release list|get|create|mark-released`, `/pmkit:report:release-notes` and the epic side of `/pmkit:spec:import` cannot run on Jira. The Unified model's common entity model maps Epic to the Jira epic, Release to the Jira version, and Status update to an Atlassian Home update or a comment.

## Goals

- **Deliverables**: `listDeliverables`, `getDeliverable`, `deliverableProgress`, `createDeliverable`, `moveDeliverable`, `updateDeliverable` over the space's epic-level work items.
- **Status updates**: `publishStatusUpdate` and `listStatusUpdates` as comments on the epic work item, marked with a comment property; an epic's `health` is its latest update's health.
- **Releases**: `listReleases`, `getRelease`, `createRelease`, `releaseIssues`, `markReleased` over the space's versions; an issue's `release` is read from and written to `fixVersions`; `searchIssues({ release })` filters on it.
- **Milestones**: Jira has none. The milestone operations, an issue's `milestone` write and an epic's `milestone` refuse with `NOT_SUPPORTED`, "Jira has no milestones", instead of naming PMK-79.
- The manifest serves `deliverables`, `status_update` and `releases`.
- The contract suite's `deliverables` and `deliverable-writes` families pass over the fake.

## Non-goals

- Atlassian Home updates (Q1): no Home read or write in this issue; filed under EPC-14.
- Goals on epics (`goal`): `strategic_goals` stays absent ("Jira goals live in Atlassian Home").
- Release git tags: a Jira version has no tag; `--tag` refuses, as on Linear. So the contract `releases` family (which creates a release with a tag and archives an issue) stays out; unit tests cover releases.
- Epics of another space, team-managed epic quirks beyond the work type level, Advanced Roadmaps "Target start/end" fields.
- Live checks: each is recorded as skipped and filed under EPC-14.

## Anti-goals

- Parsing comment text to find status updates: a human comment that looks like one is not one.
- A dry run that sends a write.
- Inventing a release date Jira does not hold.

## Facts from Atlassian's Jira Cloud REST documents (unverified on a live site)

| Call | Use |
|---|---|
| `GET /rest/api/3/project/{key}/version?startAt&maxResults` | Offset page in `values`: `id` (string), `name`, `description`, `released`, `archived`, `releaseDate` (`YYYY-MM-DD`), `startDate`, `projectId`. |
| `GET /rest/api/3/version/{id}` | One version; 404 for an unknown id. |
| `POST /rest/api/3/version` | `{ name, projectId, description?, releaseDate?, startDate? }`; Jira refuses a name the project already has (400). |
| `PUT /rest/api/3/version/{id}` | Partial update: `{ released: true, releaseDate }` marks it released. |
| `fixVersions` on a work item | Array of version objects; written as `[{ id }]`. JQL: `fixVersion = 10001`, `fixVersion is EMPTY`. |
| `POST /rest/api/3/issue/{key}/comment` with `properties: [{ key, value }]` | A comment with entity properties. `GET .../comment?expand=properties` returns them. |
| Epic work item | A work type whose hierarchy level is 1 (discovery's `level: 'epic'`); its children carry `parent: { key }`. Start date: the `start_date` field role ("Start date"); target: the `target_date` role (`duedate`). |

## Approaches

1. **Epics as work items through the existing issue operations (chosen).** A `scripts/lib/jira/epic-ops.mjs` builds the deliverable operations on top of `issueOperations` (read, create with the epic work type, update, move through transitions, comment), and a pure `scripts/lib/jira/epics.mjs` maps a work item to a pmkit epic and a comment to a status update. Versions get `scripts/lib/jira/releases.mjs` (pure mapping and operations, as Linear's `releases.mjs`). This reuses PMK-77's transitions, ADF and field writes, so an epic move or edit follows the same workflow rules as an issue.
2. **Epics as a separate read path with their own JQL and writes.** Duplicates the field mapping, the transition logic and the ADF conversion. Rejected.
3. **Status updates in a work-item property (`pmkit.statusUpdates`) instead of comments.** Invisible to Jira users, a size cap per property, and the AC names comments. Rejected.

## The epic model (`epics.mjs`)

`toEpic(issue, latest)` from the pmkit issue PMK-77 already reads, plus the latest status update:

| pmkit | Jira |
|---|---|
| `id` | `key` |
| `title` | `summary` |
| `status` | the item's status `{ name, category }` |
| `start` | the `start_date` role's field (`YYYY-MM-DD`), when set |
| `target` | the `target_date` role's field (`duedate`), when set |
| `description` | the item's description text |
| `health` | the latest status update's health, unless the epic is `done` or `canceled` (as GitHub drops it on a closed Project) **(builder's call)** |
| `url` | `https://<site>/browse/<key>` |

An epic id is an issue key of the scope space whose work type level is `epic`. Any other key (unknown, another space, a non-epic item): `NOT_FOUND`, `epic <id> does not exist`, next step `pmkit epic list`.

## Deliverables operations (`epic-ops.mjs`)

Every operation checks the manifest's `deliverables` entry first: a space with no epic-level work type fails with `NOT_SUPPORTED` and the manifest hint.

- `listDeliverables()`: JQL `project = "<space>" AND issuetype in (<epic-level type ids>)`, paged, mapped, sorted with Local's `sortEpics`. Each epic's `health` needs its latest update; ponytail: one comment read per epic; batch with a JQL over the property if lists get slow.
- `getDeliverable(id)`: the item, the epic check, the latest update.
- `deliverableProgress(id)`: the items with `parent = <epic>`, then their subtasks (`parent in (...)`, batched by 100), counted with the Local progress shape (GitHub's `countProgress`, exported and reused rather than copied). Jira's hierarchy is epic → standard → subtask, so two levels are read.
- `createDeliverable({ title, start, target, milestone, goal, description })`: `milestone` → `NOT_SUPPORTED`, "Jira has no milestones"; `goal` → `NOT_SUPPORTED`, the manifest's `strategic_goals` hint; dates checked as `YYYY-MM-DD`; a `start` with no `start_date` field → `NOT_SUPPORTED`, "No start date field in space <key>", next step `/pmkit:setup`. Creates a work item of the first epic-level work type (`issuetype: { id }`), with the dates and description in the create fields. Dry run: `{ before: null, after }` with `id: null` and the status Jira's workflow starts in (the first status of the epic type).
- `moveDeliverable(id, category, actor, { status })`: `pickMoveTarget` over the epic type's statuses (so "already in <category>" is `INVALID_INPUT`, as on GitHub and Linear), then PMK-77's `moveToCategory(key, category, actor, { status })`. A transition that needs fields fails with PMK-77's `INVALID_INPUT` and its `requiredFields`; `epic move` has no `--field`, so the next step says to move the epic in Jira **(builder's call)**.
- `updateDeliverable(id, { title, description })`: `epicEditInput`, then PMK-77's `updateIssue` with those fields; nothing changed → `INVALID_INPUT`.

## Status updates

`publishStatusUpdate({ epic, health, body })`: `health` one of `on_track`, `at_risk`, `off_track`; non-empty body; the actor check; the epic check. Then `POST .../comment` with

- `body`: ADF of `Status update: <On track|At risk|Off track>` as a first paragraph, then the body text, so Jira users read it as an update;
- `properties: [{ key: 'pmkit.statusUpdate', value: { health } }]`.

The result is `{ epic, at, author, health, body }` with `at` and `author` from Jira's answer (the viewer). Dry run: the same shape from the clock and the actor.

`listStatusUpdates(id)`: the epic's comments with `expand=properties`, keeping those with the `pmkit.statusUpdate` property, newest first (same-time ties: the later comment id first). `body` is the comment text minus the first `Status update: ...` paragraph. Other comments are not updates, and status-update comments stay in `listComments` (they are comments in Jira) **(builder's call)**.

The manifest's `status_update` becomes `{ path: 'derived', detail: { source: 'comment' } }` (Q1).

## Releases (`releases.mjs`)

| pmkit | Jira version |
|---|---|
| `id`, `name` | `name` (Q3) |
| `target` | `releaseDate`, when set |
| `released` | `<releaseDate>T12:00:00Z` when `released` is true and a date is set; else the time pmkit read it is not invented: `released` is left out and `state` is still `released` **(builder's call)** |
| `state` | `released` when `released`, else `planned` |
| `description` | `description ?? ''` |

Archived versions are outside pmkit: not listed, not read, not an issue's release (Q4).

- `listReleases({ state })`: every page of the space's versions, archived ones dropped, sorted with `compareReleaseIds`, filtered by `state` (`INVALID_INPUT` for another).
- `getRelease(id)`: by name among them, else `NOT_FOUND`, `release <id> does not exist`, next step `pmkit release list`.
- `createRelease({ id, name, tag, target, description })`: `tag` → `INVALID_INPUT`, "Jira versions have no git tag", as Linear; `name` other than `id` → `INVALID_INPUT` (a version has one name), as GitHub milestones; a taken name → `CONFLICT`. `POST /version` with `projectId` from discovery (`raw.space.id`). Dry run returns `after` with no request past the list.
- `releaseIssues(id)`: `getRelease`, then `searchIssues({ release: id })`; a cut read (`hasMore`) is `UPSTREAM`, as Linear.
- `markReleased(id, actor, { tag })`: `tag` refused; already released → `CONFLICT`; `PUT /version/<id> { released: true, releaseDate: <today UTC> }` (Jira's Release button sets today too) **(builder's call)**; returns `{ before, after, unfinished }`, the release's issues outside `done` and `canceled`.

Issue fields and search:

- Read: `fixVersions` minus archived ones: one → `release`, two or more → `releases` (sorted), as Linear.
- Search (Q2): every `searchIssues` adds `issuetype not in (<epic-level type ids>)` when the space has epic-level work types, so `issues list`, cycle plan, metrics and `issues dependencies` see no epic as an issue.
- Write (`createIssue`, `updateIssue`): `release: <id>` resolves the name (unknown → `INVALID_INPUT`, next step `pmkit release list`) and sets `fixVersions: [{ id }]`, replacing the others; `null` clears.
- `searchIssues({ release })`: JQL `fixVersion = <version id>`; an unknown name matches no issue, as on Local (ruling during Execute).
- `milestone` with a value (issue writes, epic create, milestone operations) → `NOT_SUPPORTED`, "Jira has no milestones", next step "Use a release (version) or an epic".

## Manifest

`SERVED` gains `deliverables`, `status_update` and `releases`; `SERVED_IN` loses them. `status_update` reads `{ path: 'derived', detail: { source: 'comment' } }` when `deliverables` is served, else absent with the deliverables hint.

## Tests and runbook

- Unit tests next to each module: `epics.test.mjs`, `epic-ops.test.mjs`, `releases.test.mjs`, plus the changed `issues`, `issue-ops`, `filter`, `manifest` tests.
- The stateful fake `scripts/fake-jira-issues.mjs` gains versions (the four routes), `fixVersions` on items and in JQL, and comment properties (`properties` on POST, `expand=properties` on GET).
- `scripts/lib/jira/contract.test.mjs` adds the `deliverables` and `deliverable-writes` families.
- Runbook `docs/runbooks/epics-releases-jira.md`, verified by `scripts/runbook-epics-releases-jira.test.mjs` over the fake: `capabilities`, `epic create` dry run and real run, `epic list`, `epic get`, `issues parent` to the epic, `epic progress`, `epic move`, `epic update`, `epic status` (publish, list), `release create`, `issues update --release`, `issues list --release`, `release mark-released`, and a space without an epic type (`NOT_SUPPORTED`). Live steps are listed as skipped.

## Risks

- Every REST shape above comes from the documents, not a site (EPC-14): comment properties on create, version paging, `fixVersion` JQL by id.
- A version name with characters a shell splits needs quoting in `release` commands.
- One comment read per epic in `epic list`.

## Interview answers (owner, 2026-11-23)

- Q1 Home or comment: comments only. Status updates are epic comments with the `pmkit.statusUpdate` property; `status_update` is `derived` from comments. "Publish epic status updates to Atlassian Home when the epic is linked to a Home project" is filed under EPC-14.
- Q2 Epics in issue searches: `searchIssues` leaves epic-level work items out (JQL `issuetype not in (<epic-level type ids>)`); `getIssue`, `updateIssue` and the relation operations still accept an epic key, so `issues parent <key> <epic>` works. Recorded as ADR 0017.
- Q3 Release id: the version name, unique per space.
- Q4 Archived versions: outside pmkit, not listed, not read, not an issue's release.

## Left to the builder

Module boundaries, fake internals, test names, the ADF of the status-update heading.
