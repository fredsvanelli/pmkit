# PMK-79 Jira epics, versions and status updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Jira adapter serves epics (Deliverables), versions (Releases) and status updates (epic comments), and leaves epics out of issue searches (ADR 0017).

**Architecture:** Pure mapping modules (`releases.mjs`, `epics.mjs`) and operation factories (`releaseOperations`, `epicOperations`) wired in `tracker.mjs`, as `cycle-ops.mjs` is. Epics are read and written with their own small field list; moves reuse PMK-77's `moveToCategory`. Versions are read live on each operation that needs them.

**Tech Stack:** Node 18 ES modules, no dependencies, `node:test`, the stateful fake `scripts/fake-jira-issues.mjs` behind `fakeJiraFetch`.

**Spec:** `docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md` (read it; this plan does not repeat its tables). ADR 0017.

## Global Constraints

- No dependencies (ADR 0003). ES modules `.mjs`, Node 18. `npm test` and `npm run lint` must pass after every task.
- Every write: actor check (`ops.requireActor`), all checks before any request, a dry run sends no write and returns `{ before, after }`.
- Errors are `PmkitError(code, message, nextStep)`; codes `INVALID_INPUT`, `NOT_FOUND`, `NOT_SUPPORTED`, `CONFLICT`, `UPSTREAM`.
- Copy fixed by the spec: `Jira has no milestones` (next step `Use a release (version) or an epic`); `Jira versions have no git tag` (next step `Drop --tag on Jira`); `epic <id> does not exist` (next step `pmkit epic list`); `release <id> does not exist` (next step `pmkit release list`); `Space <key> has no epic work type` (next step `/pmkit:setup`).
- Status-update comment property key: `pmkit.statusUpdate`, value `{ health }`. First ADF paragraph: `Status update: On track` / `At risk` / `Off track`.
- Released date written as today UTC (`YYYY-MM-DD`); `released` read as `<releaseDate>T12:00:00Z`.
- Every commit message ends with the issue id, e.g. `feat: ... (PMK-79)`, and the `Co-Authored-By` trailer.

## Review Focus

- A version name with spaces or quotes (`Release "A"`): `release get`, `--release` and JQL must quote it via `jqlString` / ids, never splice it. Test in Task 2 (`fixVersion` JQL uses the numeric id).
- An issue in an archived version plus a live one: reads as the live one only. Test in Task 2.
- A human comment on an epic starting with "Status update:" but without the property: not listed as an update. Test in Task 4.
- An epic key passed to `getDeliverable` that is a Story: `NOT_FOUND`. Test in Task 4.
- `issues list` on a space with an epic in a sprint: the epic is not returned (ADR 0017). Test in Task 3.

---

### Task 1: Fake Jira — versions, fixVersions, epic exclusion JQL, comment properties

**Files:**
- Modify: `scripts/fake-jira-issues.mjs`
- Test: `scripts/fake-jira-issues.test.mjs`

**Interfaces:**
- Produces: `fakeJiraIssues({ ..., versions = [] })` seeds `state.versions` (`{ id: string, name, description?, released: bool, archived: bool, releaseDate?, projectId: '10001' }`); `state.next.version` starts at 10100.
- Routes: `GET /rest/api/3/project/{key}/version` (offset page in `values`, `startAt`/`maxResults`, `isLast`), `GET /rest/api/3/version/{id}` (404 unknown), `POST /rest/api/3/version` (400 on a name the project has, 400 without `name` or with a `projectId` other than `10001`; 201 with the version), `PUT /rest/api/3/version/{id}` (merges `released`, `releaseDate`, `description`, `name`, `archived`).
- `fixVersions` is a settable field: written `[{ id }]` (400 for an unknown id), stored and read as full version objects `{ id, name, released, archived, releaseDate? }`; a new item has `fixVersions: []`. The changelog item field is `Fix Version`.
- JQL: `fixVersion = "<id>"`, `fixVersion is EMPTY`, `issuetype not in ("<id>", ...)`.
- Comments: `POST .../comment` stores `properties` (array of `{ key, value }`); `GET .../comment?expand=properties` returns each comment's `properties` array (empty array when none); without the expand the key is absent.

- [ ] **Step 1: Failing tests** in `fake-jira-issues.test.mjs`: create a version, list it, refuse a duplicate name (400), PUT released; write `fixVersions: [{ id }]` on an item and find it with `fixVersion = "<id>"` and not with `fixVersion is EMPTY`; `issuetype not in ("10000")` drops an Epic item; a comment posted with `properties` comes back with them under `expand=properties` only.
- [ ] **Step 2:** `node --test scripts/fake-jira-issues.test.mjs` fails on the new tests.
- [ ] **Step 3:** Implement in the fake (add `fixVersion` to `FORMS['=']`, `FORMS.is`, a `not in` form for `issuetype`, `VALUE.fixVersion`).
- [ ] **Step 4:** The fake's tests and `npm test` pass.
- [ ] **Step 5:** Commit `test: fake Jira versions, fix versions and comment properties (PMK-79)`.

### Task 2: Releases — versions, an issue's release, the release filter, no milestones

**Files:**
- Create: `scripts/lib/jira/releases.mjs`, `scripts/lib/jira/releases.test.mjs`
- Modify: `scripts/lib/jira/issues.mjs` (read `fixVersions`, `planRelease`, `planMilestone`; drop `LATER`), `scripts/lib/jira/filter.mjs` (release handler), `scripts/lib/jira/issue-ops.mjs` (versions for writes and search), `scripts/lib/jira/tracker.mjs` (wire release ops, milestone answers), and their tests (`issues.test.mjs`, `filter.test.mjs`, `issue-ops.test.mjs`, `tracker.test.mjs`).

**Interfaces:**
- `releases.mjs` exports:
  - `toRelease(version) -> { id, name, target?, released?, state, description }` (spec table; `id` and `name` are the version name).
  - `liveVersions(versions) -> versions` without `archived`.
  - `issueReleaseFields(fixVersions) -> {} | { release } | { releases: [...] }` over the live ones, names sorted.
  - `readVersions(client, spaceKey) -> raw versions` (every offset page of `GET /rest/api/3/project/<key>/version`, `maxResults` 50; ponytail cap 20 pages then `UPSTREAM`, as Linear's `allReleases`).
  - `releaseOperations({ client, ops, getContext, now }) -> { listReleases, getRelease, createRelease, releaseIssues, markReleased, versions }` where `versions()` returns the live raw versions. `markReleased` returns `{ before, after, unfinished, problems: [] }`; `releaseIssues(id, { archived })` ignores `archived` (Jira has no archive) and is `UPSTREAM` on `hasMore`.
- `toIssue` reads `fields.fixVersions` through `issueReleaseFields`; `BASE_FIELDS` gains `fixVersions`.
- `toFields(patch, before, context, { ..., versions = [] })`: `release` string → the live version by name, else `INVALID_INPUT` `release <id> does not exist`, next step `pmkit release list`; sends `fixVersions: [{ id }]` when it changes; `null` sends `fixVersions: []` when the issue has a release. `milestone` with a value → `NOT_SUPPORTED` `Jira has no milestones`; `null` stays a no-op.
- `translateFilter(filter, context, { activeId, versionId })`: `release` → `fixVersion = "<versionId>"`, or `out.empty` when `versionId` is undefined (unknown name matches nothing, as Local).
- `issueOperations({ ..., versions = async () => [] })`: reads versions only when a patch or filter names a release (string).
- Tracker: `listMilestones` → `[]`, `getMilestone(id)` → `NOT_FOUND` `milestone <id> does not exist: Jira has no milestones`, `createMilestone` → `NOT_SUPPORTED` `Jira has no milestones`; all through `guarded`.

- [ ] **Step 1: Failing tests**:
  - `releases.test.mjs`: `toRelease` of a planned dated version, a released one (`released: '2026-12-01T12:00:00Z'`), a released one without a date (no `released`, state `released`); `issueReleaseFields` with one live + one archived → `{ release }`, with two live → `{ releases }` sorted; over the fake: list sorted with `compareReleaseIds`, archived left out, `--state` filter and `INVALID_INPUT` for another state, `getRelease` unknown → `NOT_FOUND`, `createRelease` with `tag` → `INVALID_INPUT`, with a `name` other than `id` → `INVALID_INPUT`, taken name → `CONFLICT`, dry run sends no write, `markReleased` sends `PUT { released: true, releaseDate: '2026-11-22' }` and returns `unfinished`, already released → `CONFLICT`.
  - `issue-ops.test.mjs`: `updateIssue(key, { release: '2.0' })` sends `fixVersions: [{ id }]` and reads back `release: '2.0'`; `release: 'nope'` → `INVALID_INPUT`; `release: null` clears; `milestone: 'm1'` → `NOT_SUPPORTED`; `searchIssues({ release: '2.0' })` returns the item; `searchIssues({ release: 'Release "A"' })` with that version sends the numeric id in the JQL; unknown name returns `[]`.
  - `tracker.test.mjs`: `listMilestones()` is `[]`; `createMilestone` is `NOT_SUPPORTED` with `Jira has no milestones`.
- [ ] **Step 2:** Run the four test files; the new tests fail.
- [ ] **Step 3:** Implement as the Interfaces say. `createRelease` POSTs `{ name: id, projectId: context.raw.space.id, description?, releaseDate? }` (`target` checked with `validDate`).
- [ ] **Step 4:** The test files and `npm test` pass.
- [ ] **Step 5:** Commit `feat: Jira versions are releases; Jira has no milestones (PMK-79)`.

### Task 3: Epics leave issue searches (ADR 0017)

**Files:**
- Modify: `scripts/lib/jira/filter.mjs`, `scripts/lib/jira/filter.test.mjs`, `scripts/lib/jira/issue-ops.test.mjs`

**Interfaces:**
- `epicTypeIds(context) -> string[]`, exported from `filter.mjs`: ids of `context.raw.workTypes` with `level === 'epic'`.
- `translateFilter` adds `issuetype not in (<ids>)` after the project clause when the list is not empty.

- [ ] **Step 1: Failing tests**: `translateFilter({}, context)` JQL is `project = "ENG" AND issuetype not in ("10000") ORDER BY created ASC, key ASC`; a context with no epic type adds nothing; over the fake, an Epic item in a sprint is not in `searchIssues({})` nor `searchIssues({ sprint: id })`, and `getIssue(epicKey)` still reads it.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` passes (fix any existing expectation that listed an epic, citing ADR 0017).
- [ ] **Step 5:** Commit `feat: Jira issue searches leave epics out (ADR 0017) (PMK-79)`.

### Task 4: Epics as deliverables and status updates as comments

**Files:**
- Create: `scripts/lib/jira/epics.mjs`, `scripts/lib/jira/epics.test.mjs`, `scripts/lib/jira/epic-ops.mjs`, `scripts/lib/jira/epic-ops.test.mjs`
- Modify: `scripts/lib/github/project-ops.mjs` (move `countProgress` out), `scripts/lib/model.mjs` (export `countProgress(issues)`, unchanged body), `scripts/lib/jira/tracker.mjs`, `scripts/lib/jira/manifest.mjs`, `scripts/lib/jira/manifest.test.mjs`, `scripts/lib/jira/contract.test.mjs`

**Interfaces:**
- `epics.mjs` exports:
  - `EPIC_FIELDS(context) -> string[]`: `summary, status, issuetype, description, duedate` plus the `start_date` role's field id when set.
  - `toEpic(item, context, latest) -> { id, title, status, start?, target?, description, health?, url }` (spec "The epic model"; `health` left out when the category is `done` or `canceled`).
  - `STATUS_UPDATE = 'pmkit.statusUpdate'`.
  - `statusUpdateBody(health, body) -> ADF` (`textToAdf('Status update: <Label>\n\n<body>')`).
  - `toStatusUpdate(comment, epicId) -> { epic, at, author, health, body } | null`: null without the property; `body` is the comment text with the first `Status update: ...` paragraph removed, trimmed.
- `epic-ops.mjs`: `epicOperations({ client, ops, getContext, now }) -> { listDeliverables, getDeliverable, deliverableProgress, createDeliverable, moveDeliverable, updateDeliverable, publishStatusUpdate, listStatusUpdates }`.
  - Every operation first refuses a space with no epic-level work type: `NOT_SUPPORTED` `Space <key> has no epic work type`, `/pmkit:setup`.
  - Epic read: `GET /rest/api/3/issue/<key>?fields=<EPIC_FIELDS>`; not an epic-level type, another space, malformed or 404 → `NOT_FOUND` `epic <id> does not exist`.
  - `listDeliverables`: JQL `project = "<space>" AND issuetype in (<epic ids>) ORDER BY created ASC, key ASC` through `client.paginate`, then `sortEpics`. ponytail comment: one comment read per epic for health.
  - `deliverableProgress(id)`: `ops.searchIssues({ parent: id })`, then `ops.searchIssues({ parent: child })` for each child with `children.length > 0`; `countProgress` over both levels; `hasMore: true` when any read had more. ponytail comment: one search per child with subtasks.
  - `createDeliverable`: spec rules; POST `{ fields: { project: { key }, issuetype: { id: <first epic type> }, summary, description?: ADF, duedate?: target, [startField]?: start } }`, then read back. Dry run `after`: `id: null`, status the first status of the epic type with its category, dates, description.
  - `moveDeliverable(id, category, actor, { status, dryRun })`: `pickMoveTarget({ before, category, status, targets: <epic type statuses as { name, category }>, tracker: 'Jira' })`, then `ops.moveToCategory(id, category, actor, { status: target.name, dryRun })`; dry run `after` is `before` with the target status; real run rereads the epic.
  - `updateDeliverable`: `epicEditInput`; no change → `INVALID_INPUT` `epic <id> already has this title and description`; PUT `summary` and/or `description` (ADF, `null` for empty).
  - `publishStatusUpdate({ epic, health, body })`: `HEALTH` check, non-empty body, actor, epic check; POST `.../comment` `{ body: statusUpdateBody(...), properties: [{ key: STATUS_UPDATE, value: { health } }] }`; result from Jira's answer (`at` = `jiraTime(created)`, `author` = `author.accountId`). Dry run: `at` from `now()`, `author` the actor.
  - `listStatusUpdates(id)`: every page of `GET .../comment?expand=properties`, `toStatusUpdate`, nulls dropped, newest first (ties: higher comment id first).
- Manifest: `SERVED` gains `deliverables`, `status_update`, `releases`; `SERVED_IN` keeps only `time_tracking`; `status_update` answer is the deliverables answer when absent, else `{ path: 'derived', detail: { source: 'comment' } }`.
- Contract: `families` gains `deliverables`, `deliverable-writes`.

- [ ] **Step 1: Failing tests**:
  - `epics.test.mjs`: `toEpic` maps the spec table (start from `customfield_10015`, target from `duedate`, `url` `https://acme.atlassian.net/browse/ENG-1`, health dropped on done); `toStatusUpdate` of a comment with the property, and `null` for a human comment `Status update: On track\n\nfine` without it.
  - `epic-ops.test.mjs` over the fake: create (dry run sends no write; `milestone` and `goal` → `NOT_SUPPORTED`; a bad date → `INVALID_INPUT`), get (a Story key → `NOT_FOUND`), list sorted, progress over a child and its subtask, move (refuses the same category; with `requireResolution: true` the move to done fails with `requiredFields`), update (no change → `INVALID_INPUT`), publish then list two updates newest first with health and body, `health` on `getDeliverable` from the latest update, a space without the Epic type → `NOT_SUPPORTED`.
  - `manifest.test.mjs`: `deliverables` native `{ entity: 'epic' }`, `releases` native `{ entity: 'version' }`, `status_update` derived `{ source: 'comment' }`; without an epic type `status_update` is absent.
  - `contract.test.mjs`: add the two families.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement; move `countProgress` to `model.mjs` and import it in GitHub's `project-ops.mjs`.
- [ ] **Step 4:** `npm test` and `npm run lint` pass.
- [ ] **Step 5:** Commit `feat: Jira epics are deliverables with status updates as comments (PMK-79)`.

## After the plan (SPEC-SS Check, not plan tasks)

Runbook `docs/runbooks/epics-releases-jira.md` and `scripts/runbook-epics-releases-jira.test.mjs` (spec "Tests and runbook"), the CHANGELOG entry, and the live checks filed under EPC-14.
