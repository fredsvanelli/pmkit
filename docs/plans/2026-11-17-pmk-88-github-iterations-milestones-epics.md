# PMK-88 GitHub iterations, milestones, epics and status updates: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GitHub tracker implements the Cycles, Capacity, Deliverables and Milestones families: sprints on the Project's iteration field, epics on linked Projects with status updates, and milestones on repository milestones.

**Architecture:** Two pure modules (`cycles.mjs`, `projects.mjs`) map GitHub nodes to sprints, epics, status updates and milestones and hold their GraphQL documents. Two operation modules (`cycle-ops.mjs`, `project-ops.mjs`) run them through the client. The issue model gains a `sprint` field role, the milestone and the parent rule, and `tracker.mjs` wires the new operations behind `guarded`. The stateful fake GitHub grows iterations, epic Projects, status updates and milestones, so unit tests, the contract suite and the runbook E2E test run without a network.

**Tech stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/specs/2026-11-17-pmk-88-github-iterations-milestones-epics-design.md` (approved 2026-11-17). ADR 0010. Read the spec before any task; this plan does not repeat its tables.

## Global constraints

- No new dependency. Tests use `node:test` and `node:assert/strict`. No test starts a real `gh` or opens a socket.
- Every commit message carries `PMK-88` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `package-lock.json`.
- Prose in docs, errors and comments follows `~/.claude/skills/unslop/SKILL.md`: no em dashes, sentence-case headings, active voice, plain words.
- Error messages and next steps use the exact text of the spec where it gives one: `a GitHub iteration has no goal`, `Add the iteration in the Project settings on GitHub`, `GitHub ends an iteration on its end date`, `a GitHub milestone has one name, its title`, `parent X is not an existing issue or epic`.
- Every GraphQL document starts with its operation (`query PmkitX(` or `mutation PmkitX(`), because the fake routes by the first definition.
- `scripts/fake-gh.mjs` must not change. Existing callers of `scripts/fake-github-api.mjs` and `scripts/fake-github-issues.mjs` keep their behavior.
- Local and Linear outputs stay byte-identical: `node --test scripts/goldens.test.mjs` passes after every task.
- PMK-89 edits `manifest.mjs`, `documents.mjs`, `discovery.mjs` and `mappings.mjs` in parallel. Edits there stay additive and local: new entries, new branches, no reordering or renames.
- Known failures on this machine, not yours (PMK-333): `github-host` "default exec throws ENOENT", the two `cli-pr` tests "pr diff local fallback of a stacked pull request" and "pr open counts only what the branch lacks", and the `validate-views` case clash.

## Review focus

1. An issue with no item in the scope Project moved into a sprint (`cycle add 12 --to 2026-11-16`): the adapter adds the item first and the issue reads `sprint: 2026-11-16`. Test in Task 7.
2. `openCycle` on a field with completed iterations: the update sends the completed and current iterations with their ids, and an item in a completed iteration keeps it. Test in Task 6 (pure) and Task 7 (fake).
3. `epic update-status` after an `INACTIVE` first update with dates: the new update carries the same `startDate` and `targetDate`, and `epic get` shows them. Test in Task 9.
4. An issue that is a sub-issue and also an item of an epic Project: `parent` is the parent issue; `setParent(id, 'acme/12')` removes the sub-issue link and the issue then reads `parent: acme/12`. Test in Task 10.
5. `milestone create v1.0 --name "Version one"`: `INVALID_INPUT` with the spec's message and no REST call. Test in Task 8.

---

## Schema reference (checked 2026-11-17)

- Iteration field: `ProjectV2IterationField { id name dataType configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } }`.
- `updateProjectV2Field(input: { fieldId, iterationConfiguration: { startDate, duration, iterations: [{ id?, title, startDate, duration }] } }) { projectV2Field { ... on ProjectV2IterationField { id configuration { ... } } } }`. `id` exists only on github.com and GHE.com.
- Item value: `... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration }`. Write: `updateProjectV2ItemFieldValue { value: { iterationId } }`.
- Projects: `repository.projectsV2(first, after) { nodes { id number title closed url shortDescription readme owner { login } } }`; `repositoryOwner(login).projectV2(number)`; `ProjectV2.items(first, after) { nodes { id isArchived content { ... on Issue { <ISSUE_REF> } } } }`; `ProjectV2.statusUpdates(first, after, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { id status body startDate targetDate createdAt creator { login } } }`.
- `createProjectV2(input: { ownerId, title, repositoryId }) { projectV2 { id number } }`, `updateProjectV2(input: { projectId, readme }) { projectV2 { id } }`, `createProjectV2StatusUpdate(input: { projectId, status, body, startDate, targetDate }) { statusUpdate { id } }`, `deleteProjectV2Item(input: { projectId, itemId }) { deletedItemId }`.
- Milestones: `repository.milestones(first, after, states: [OPEN, CLOSED]) { nodes { id number title description dueOn state } }`; `Issue.milestone { id number title }`; `filterBy: { milestoneNumber }` (`"none"` for no milestone); `createIssue`/`updateIssue` take `milestoneId`. REST create: `POST repos/{owner}/{repo}/milestones` with `{ title, due_on }`, answer `{ number, title, node_id, due_on, state, description }`, 422 with `already_exists` for a taken title.
- Timeline: `MILESTONED_EVENT` (`MilestonedEvent { milestoneTitle }`), `DEMILESTONED_EVENT` (`DemilestonedEvent { milestoneTitle }`).

## Host features

`hostFeatures({ host, ghesVersion })` in `scripts/lib/github/documents.mjs` gains `iterationIds`: true on github.com and `*.ghe.com`, false on GHES. Task 1 adds it; Tasks 6 and 7 read `context.features.iterationIds`.

---

### Task 1: issue fragment, timeline and host feature

**Files:**
- Modify: `scripts/lib/github/documents.mjs`, `scripts/lib/github/issues.mjs` (`ROLES`)
- Test: `scripts/lib/github/documents.test.mjs`

**Interfaces:**
- Produces: `ROLES.sprint = { key: 'sprint', flag: 'sprint', alias: 'fSprint', variable: 'fSprint' }`; `hostFeatures(...).iterationIds`; the fragment selects `milestone { id number title }`, each item's `project { id number owner { login } }`, and `fSprint: fieldValueByName(name: $fSprint)` when `projectFields.sprint`; `PROJECT_VALUE` has the iteration value branch; `ITEM_TYPES` adds `MILESTONED_EVENT` and `DEMILESTONED_EVENT`.

- [ ] **Step 1: Write the failing tests**: `hostFeatures` gives `iterationIds` true for `github.com` and `acme.ghe.com`, false for GHES 3.21; the issue document with `projectFields.sprint` declares `$fSprint: String!` and selects `fSprint: fieldValueByName(name: $fSprint)`; every issue document selects `milestone { id number title }` and `project { id number owner { login } }` inside `projectItems`; the timeline document lists the two milestone item types and selects `milestoneTitle`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/documents.test.mjs`. Expected: the new cases fail.
- [ ] **Step 3: Implement** the additions above. The item selection must select `project { id number owner { login } }` even without a Status field, because the parent rule reads epic items (so `projectItems` is selected whenever the scope repository is read, not only when `projectFields.status`).
- [ ] **Step 4: Run** the documents, issues and history tests and `node --test scripts/goldens.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: select sprint, milestone and item Projects in the GitHub issue fragment (PMK-88)`.

### Task 2: the fake GitHub grows iterations, epics, status updates and milestones

**Files:**
- Modify: `scripts/fake-github-issues.mjs`, `scripts/fake-github-api.mjs` (`answerGhWith` routes a non-graphql `api` call to an optional `rest(method, path, body)` handler)
- Test: `scripts/fake-github-issues.test.mjs`

**Interfaces:**
- Produces: options `project.iterations: { fieldName = 'Sprint', duration = 14, startDay, iterations: [{ id, title, startDate, duration }], completed: [...] }` (adds an iteration field to the scope Project), `epics: [{ id, owner, number, title, closed, readme, shortDescription, linked = true }]`, `milestones: [{ title, number, description, dueOn, state }]`, `ownerId = 'O_1'`. Seed: `item.values.Sprint: '<start date>'`, `milestone: '<title>'`, `epics: ['acme/12']` (adds items in epic Projects). Helpers: `seedStatusUpdate(epicId, { status, body, startDate, targetDate, createdAt, creator })`. Operations: `PmkitIterationField`, `PmkitUpdateIterations`, `PmkitLinkedProjects` (from state, paged), `PmkitEpic`, `PmkitEpicItems`, `PmkitStatusUpdates`, `PmkitCreateProject`, `PmkitUpdateProjectReadme`, `PmkitCreateStatusUpdate`, `PmkitDeleteProjectItem`, `PmkitMilestones`; REST `POST repos/<repo>/milestones`.
- Rules the fake enforces: `PmkitUpdateIterations` replaces the configuration; an iteration sent with an `id` keeps that id, one without gets a new id; items whose iteration id is gone lose their value. On a GHES fake an iteration with `id` answers the validation error `InputObject 'ProjectV2Iteration' doesn't accept argument 'id'`. The issue fragment answers `milestone`, each item's `project { id number owner { login } }`, and `fSprint` as `ProjectV2ItemFieldIterationValue`. `filterBy.milestoneNumber` filters `PmkitIssues`. `addProjectV2ItemById`, `updateProjectV2ItemFieldValue` and `deleteProjectV2Item` work on any Project of the fake. REST create answers 201 with the milestone, or 422 `{ message: 'Validation Failed', errors: [{ code: 'already_exists' }] }` for a taken title.

- [ ] **Step 1: Write the failing tests** for each operation and rule above, one `test` per rule, through `fake.handle(name, variables)` and, for REST, through `fake.exec('gh', ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/widgets/milestones', '--include', '--input', '-'], { input })`.
- [ ] **Step 2: Run** `node --test scripts/fake-github-issues.test.mjs`. Expected: new cases fail, old ones pass.
- [ ] **Step 3: Implement** the state (`projects` list next to `project`, `milestones`, `statusUpdates`) and the handlers. Keep `state.project` as the scope Project so existing callers see no change; `STATE_VERSION` moves to 2 and `fakeGithubIssuesFrom` accepts 1 by filling the new keys empty.
- [ ] **Step 4: Run** `node --test scripts/fake-github-issues.test.mjs scripts/lib/github/*.test.mjs scripts/*github*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `test: add iterations, epic Projects, status updates and milestones to the fake GitHub (PMK-88)`.

### Task 3: the client's REST call

**Files:**
- Modify: `scripts/lib/github/client.mjs`
- Test: `scripts/lib/github/client.test.mjs`

**Interfaces:**
- Produces: `client.rest(method: string, path: string, body?: object) => Promise<object>` (the parsed JSON body).

- [ ] **Step 1: Write the failing tests**: `rest('POST', 'repos/acme/widgets/milestones', { title: 'v1' })` runs `gh api --hostname <host> --method POST repos/acme/widgets/milestones --include --input -` with the JSON body on stdin and returns the parsed body on 201; a 401 is `AUTH`; a 422 with `already_exists` is `CONFLICT` with the message `GitHub already has a milestone titled v1` when the path ends in `/milestones`; a timeout is the unconfirmed-mutation error of `send`; a non-`POST` method with no body sends no `--input`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/client.test.mjs`. Expected: new cases fail.
- [ ] **Step 3: Implement** `rest` next to `request`, reusing `parseIncluded`, `refusal` and `unconfirmed`. A REST call is a write when the method is not `GET` and is never retried. A 2xx returns `JSON.parse(body)`. Other 4xx is `UPSTREAM` with GitHub's `message`.
- [ ] **Step 4: Run** the client tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add a REST call to the GitHub client (PMK-88)`.

### Task 4: the sprint mapping, discovery and setup

**Files:**
- Modify: `scripts/lib/github/mappings.mjs`, `scripts/lib/github/discovery.mjs`
- Test: `scripts/lib/github/mappings.test.mjs`, `scripts/lib/github/discovery.test.mjs`, `scripts/runbook-setup-github.test.mjs`, `docs/runbooks/setup-github.md`

**Interfaces:**
- Produces: `FIELD_ROLES` includes `sprint`, with `FIELD_TYPES.sprint = ['ITERATION']`, Project fields only, recommended names `iteration`, `sprint`; raw discovery carries `owner.id` (`raw.ownerId`) and each iteration field's `configuration`; `iterationFieldOf(raw, pmkit) => field | null`.

- [ ] **Step 1: Write the failing tests**: setup offers the Project's iteration fields for `mappings.fields.sprint` and recommends `Sprint`; it never offers an issue field for it; `issue:Sprint` is a broken mapping with `mappings.fields.sprint must name a Project iteration field`; a held `project:Sprint` that the Project lost is broken; `tracker.scope.project: none` asks no sprint question; the Project query selects `configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } }` inside the iteration branch; the repo query selects `owner { id login __typename }`.
- [ ] **Step 2: Run** the two test files. Expected: new cases fail.
- [ ] **Step 3: Implement** the additions. The discovery cache key and format do not change version; an old cache entry without `configuration` reads as no iterations until the next refresh (`isRawDiscovery` stays as is).
- [ ] **Step 4: Update** `docs/runbooks/setup-github.md` with the sprint question and its E2E test with one new case.
- [ ] **Step 5: Run** the mapping, discovery and setup runbook tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat: map the GitHub iteration field as the sprint field (PMK-88)`.

### Task 5: the issue model reads sprint, milestone and the epic parent

**Files:**
- Modify: `scripts/lib/github/issues.mjs`, `scripts/lib/github/tracker.mjs` (`getContext` adds `epics`)
- Test: `scripts/lib/github/issues.test.mjs`

**Interfaces:**
- Consumes: `ROLES.sprint` (Task 1).
- Produces: `context.epics: Map<projectNodeId, epicId>` (epic id `owner/number`, owner as GitHub writes it), set by `getContext` from `epicProjects()` (Task 9 owns the read; this task stubs it with the linked-Projects query: every linked Project but the scope one). `toIssue` sets `sprint` (the item value's `startDate`), `milestone` (`node.milestone.title`) and `parent` (parent issue id, else the epic of the lowest Project number among the node's items whose project id is in `context.epics`).

- [ ] **Step 1: Write the failing tests**: an item with an iteration value reads `sprint: '2026-11-16'`; no value reads no `sprint` key; `milestone` reads the title; an issue in epic Projects 12 and 9 reads `parent: 'acme/9'`; an issue with a parent issue and an epic item reads the parent issue; an item in an unlinked Project is ignored.
- [ ] **Step 2: Run** `node --test scripts/lib/github/issues.test.mjs`. Expected: new cases fail.
- [ ] **Step 3: Implement** `toIssue` and `makeContext(raw, pmkit, { epics = new Map() } = {})`, and the `projectFields.sprint`/`fieldVariables.fSprint` setup in `makeContext` from `iterationFieldOf`.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs` and the goldens. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read the sprint, milestone and epic parent of a GitHub issue (PMK-88)`.

### Task 6: pure sprint mapping

**Files:**
- Create: `scripts/lib/github/cycles.mjs`, `scripts/lib/github/cycles.test.mjs`

**Interfaces:**
- Produces:
  - `iterationEnd(iteration) => 'YYYY-MM-DD'` (`startDate + duration - 1` days).
  - `iterationState(iteration, { completed: boolean, today: string }) => 'planned'|'active'|'closed'`.
  - `toSprint(iteration, { completed, today, entry }) => { id, name, start, end, goal: '', state, capacity, daysOff }`, `entry` from the capacity store.
  - `sprintsOf(configuration, today) => { sprints, warnings }` in start order; a duplicate start date keeps the first and warns `two iterations start on <date>; pmkit shows the first`.
  - `appendIteration(configuration, { start, end, name }) => iterationConfiguration` (`startDate` of the first iteration, the field `duration`, every completed and current iteration with `id`, `title`, `startDate`, `duration`, plus the new one, in start order).
  - `ITERATION_FIELD_QUERY` (`query PmkitIterationField($project: ID!, $field: String!)`, reads `node(id: $project) { ... on ProjectV2 { field(name: $field) { ... on ProjectV2IterationField { id configuration { ... } } } } }`) and `UPDATE_ITERATIONS` (`mutation PmkitUpdateIterations`).

- [ ] **Step 1: Write the failing tests** with the spec's values: an iteration `{ startDate: '2026-11-16', duration: 14 }` ends `2026-11-29`; it is `active` on `2026-11-16` and `2026-11-29`, `planned` on `2026-11-15`, and `closed` whenever it is in `completedIterations`; `appendIteration` on one completed and one current iteration returns three iterations, the first two with their ids, in date order; duplicate start dates give one sprint and one warning.
- [ ] **Step 2: Run** `node --test scripts/lib/github/cycles.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the module. Dates are compared as `YYYY-MM-DD` text; day arithmetic uses UTC.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat: map GitHub iterations to sprints (PMK-88)`.

### Task 7: cycle operations, capacity, the sprint write and filter

**Files:**
- Create: `scripts/lib/github/cycle-ops.mjs`, `scripts/lib/github/cycle-ops.test.mjs`
- Modify: `scripts/lib/github/writes.mjs` (sprint write), `scripts/lib/github/filter.mjs` (sprint step), `scripts/lib/linear/capacity-store.mjs` (text sort for date ids)
- Test: `scripts/lib/github/writes.test.mjs`, `scripts/lib/github/filter.test.mjs`, `scripts/lib/linear/capacity-store.test.mjs`

**Interfaces:**
- Consumes: Task 6's functions; `ops.searchIssues`, `ops.readNode` (PMK-87 `issueOperations`).
- Produces: `cycleOperations({ client, ops, config, getContext, now }) => { listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, setCapacity, getDaysOff, updateCycleCapacity }` with the Local signatures. The capacity key is `github:<project owner>/<number>`.

- [ ] **Step 1: Write the failing tests** over the fake (`project.iterations` set, `mappings.fields.sprint: project:Sprint`): `listCycles` lists completed and current iterations with states; `listCycles({ state: 'active' })`; `currentCycle` is null when none is active; `cycleIssues` returns the issues of an iteration and `[]` for an unknown date; `openCycle({ start: '2026-11-30' })` sends one `PmkitUpdateIterations` whose iterations keep their ids, and an item in the first iteration still reads its sprint after; `openCycle` defaults `end` to `start + 13` and `name` to `Sprint 2026-11-30`; an existing start date and an overlapping range are `INVALID_INPUT`; `goal` is `NOT_SUPPORTED` with `a GitHub iteration has no goal`; on a GHES 3.21 fake it is `NOT_SUPPORTED` with the next step `Add the iteration in the Project settings on GitHub` and sends nothing; a dry run sends nothing; `closeCycle` is `NOT_SUPPORTED` with `GitHub ends an iteration on its end date`; `moveToCycle(['12'], '2026-11-16')` on an issue without an item adds the item and sets the iteration (Review focus 1); `moveToCycle(['12'], 'current')` uses the active sprint; `to: null` clears it; a closed sprint target is refused as on Local; a failure on the second issue lists the first as moved; capacity set, read, patched and cleared through `.pmkit/capacity.yaml`. In `writes.test.mjs`: `createIssue` with `sprint: '2026-11-16'` writes `{ iterationId }`, an unknown date is `INVALID_INPUT` after one refresh, `sprint: null` on update clears. In `filter.test.mjs`: `sprint: 'current'`, a date and `'none'` become client steps; any other value is `INVALID_INPUT` `sprint "x" is not current, none or a start date`.
- [ ] **Step 2: Run** the four test files. Expected: new cases fail.
- [ ] **Step 3: Implement**. `listCycles` reads `ITERATION_FIELD_QUERY` fresh each call; after `openCycle` the tracker drops its discovery memo (`getContext({ refresh: true })` on the next write). The sprint write is a Project item field write through the existing `fieldWrite` path: `valueWrite` gains `ITERATION`, resolving `'current'` and a start date against the discovery configuration, throwing the existing stale error on a miss so the caller refreshes once. `checkPatch` stops refusing `sprint`.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs scripts/lib/linear/*.test.mjs` and the goldens. Expected: PASS.
- [ ] **Step 5: Commit** `feat: GitHub sprints, sprint moves and capacity (PMK-88)`.

### Task 8: milestones

**Files:**
- Create: `scripts/lib/github/projects.mjs` (milestone part), `scripts/lib/github/project-ops.mjs` (milestone part), tests for both
- Modify: `scripts/lib/github/writes.mjs` (milestone write), `scripts/lib/github/filter.mjs` (milestone clause), `scripts/lib/github/history.mjs` (milestone events)
- Test: `writes.test.mjs`, `filter.test.mjs`, `history.test.mjs`

**Interfaces:**
- Produces: `toMilestone(node) => { id: title, name: title, due?, description?, status: 'open'|'closed' }`; `MILESTONES_QUERY` (`query PmkitMilestones`); `projectOperations({ client, ops, config, getContext, now })` returning, for now, `{ listMilestones, getMilestone, createMilestone }`; `context.milestones()` (memoized per run) for writes and the filter.

- [ ] **Step 1: Write the failing tests**: list sorts by due then id and includes a closed milestone with `status: 'closed'`; `getMilestone('v1.0')` finds by exact title, `getMilestone('V1.0')` is `NOT_FOUND` with the next step `pmkit milestone list`; a title with spaces is a valid id; `createMilestone({ id: 'v2', due: '2026-12-31' })` sends the REST call with `{ title: 'v2', due_on: '2026-12-31T00:00:00Z' }` and returns the milestone; a taken title is `CONFLICT`; `name: 'Version one'` with `id: 'v1.0'` is `INVALID_INPUT` with `a GitHub milestone has one name, its title` and no call (Review focus 5); `name` equal to `id` is accepted; a dry run sends nothing. Writes: `createIssue` and `updateIssue` with `milestone: 'v1.0'` send `milestoneId`, `null` clears, an unknown title is `INVALID_INPUT` with the next step `pmkit milestone create <id>`. Filter: `milestone: 'v1.0'` sends `filterBy.milestoneNumber: '<number>'`, `'none'` sends `"none"`, an unknown title returns `[]`. History: a `MilestonedEvent` then a `DemilestonedEvent` become two `update` events on `milestone`.
- [ ] **Step 2: Run** the test files. Expected: new cases fail.
- [ ] **Step 3: Implement**. `checkPatch` keeps refusing only `release`.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs` and the goldens. Expected: PASS.
- [ ] **Step 5: Commit** `feat: GitHub milestones and the issue milestone (PMK-88)`.

### Task 9: epics and status updates

**Files:**
- Modify: `scripts/lib/github/projects.mjs`, `scripts/lib/github/project-ops.mjs`, `scripts/lib/format.mjs` (a missing `health` prints `-`, only if it does not already)
- Test: `projects.test.mjs`, `project-ops.test.mjs`

**Interfaces:**
- Produces: `parseEpicId(id) => { owner, number } | null` (`^[A-Za-z0-9-]+\/\d+$`); `toEpic(project, latest) => { id, title, status: { name, category }, start?, target?, description, health?, url }`; `toStatusUpdate(node, epicId) => { epic, at, author, health?, status?, body }`; `STATUS_OF = { INACTIVE: ['Inactive', 'backlog'], ON_TRACK: ['On track', 'in_progress'], AT_RISK: ['At risk', 'in_progress'], OFF_TRACK: ['Off track', 'in_progress'], COMPLETE: ['Complete', 'done'] }`, closed gives `['Closed', 'done']`, no update `['No update', 'todo']`; `projectOperations` adds `epicProjects()`, `listDeliverables`, `getDeliverable`, `deliverableProgress`, `createDeliverable`, `publishStatusUpdate`, `listStatusUpdates`. `epicProjects()` pages `PmkitLinkedProjects` (20 per page, 10 pages, warning past that) and drops the scope Project; Task 5's stub now calls it.

- [ ] **Step 1: Write the failing tests**: every status mapping and health (`ON_TRACK` gives `on_track`; `INACTIVE` and `COMPLETE` give no `health`); dates from the latest update; description from `readme`, else `shortDescription`; `listDeliverables` lists linked Projects without the scope one, sorted by start then id, closed ones as `done`; `getDeliverable('acme/12')` and `'ACME/12'` find it, `'acme/7'` (the scope Project) and an unlinked Project are `NOT_FOUND` with the next step `pmkit epic list`; `deliverableProgress` counts an item, its sub-issue, a canceled issue and an archived item with the Local rules; `createDeliverable({ title, start, target, description })` sends `PmkitCreateProject` with `ownerId`, `repositoryId` and `title`, then `PmkitUpdateProjectReadme`, then `PmkitCreateStatusUpdate` with `status: INACTIVE` and the dates, and returns the epic with `start`, `target` and `status.name: 'Inactive'`; without dates or description it sends one mutation; a failure of the second mutation is `UPSTREAM` naming `acme/<n>` and `Set the readme of the Project on GitHub`; `milestone` and `goal` are `NOT_SUPPORTED`; `publishStatusUpdate` copies the latest dates (Review focus 3), rejects a bad health and an empty body as Local does, and an unknown epic is `NOT_FOUND` before any write; `listStatusUpdates` is newest first; dry runs send nothing.
- [ ] **Step 2: Run** the two test files. Expected: new cases fail.
- [ ] **Step 3: Implement**. `HEALTH` comes from `scripts/lib/local/epics.mjs`; progress reuses the Local counting helper if one is exported, else a small local one with the same rules.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs` and the goldens. Expected: PASS.
- [ ] **Step 5: Commit** `feat: GitHub epics as linked Projects, with status updates (PMK-88)`.

### Task 10: the parent rule writes and the epic filter

**Files:**
- Modify: `scripts/lib/github/relation-ops.mjs`, `scripts/lib/github/issue-ops.mjs` (create with an epic parent), `scripts/lib/github/filter.mjs` (`parentStep` for an epic id)
- Test: `relation-ops.test.mjs`, `issue-ops.test.mjs`, `filter.test.mjs`

**Interfaces:**
- Consumes: `epicProjects()` and `parseEpicId` (Task 9), `context.epics` (Task 5).

- [ ] **Step 1: Write the failing tests**: `setParent('12', 'acme/12')` adds the item and the issue reads `parent: 'acme/12'`; on a sub-issue it first removes the sub-issue link (Review focus 4); on an issue already in epic `acme/9` it deletes that item; `setParent('12', null)` removes a parent issue when there is one, else every epic item; the scope Project's item is never deleted; an unknown epic is `INVALID_INPUT` `parent acme/99 is not an existing issue or epic`; a dry run sends nothing and previews the new parent; `createIssue({ parent: 'acme/12' })` adds the item after the create; `searchIssues({ parent: 'acme/12' })` keeps only issues whose shown parent is the epic.
- [ ] **Step 2: Run** the three test files. Expected: new cases fail.
- [ ] **Step 3: Implement** with `addProjectV2ItemById`, `deleteProjectV2Item` and the PMK-87 `removeSubIssue` path.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: put GitHub issues in epics through setParent (PMK-88)`.

### Task 11: manifest, tracker wiring and the contract suite

**Files:**
- Modify: `scripts/lib/github/manifest.mjs`, `scripts/lib/github/tracker.mjs`, `scripts/lib/github/contract.test.mjs`
- Test: `scripts/lib/github/manifest.test.mjs`, `scripts/lib/github/tracker.test.mjs`

- [ ] **Step 1: Write the failing tests**: the four manifest rows of the spec, for github.com with a sprint field (`cycles` native with `detail { field: 'Sprint', open: true, close: false, schedule: 'project', history: false }`), GHES (`open: false`), no sprint mapping (`cycles` absent with `Map an iteration field of the Project with /pmkit:setup`, `capacity` absent with `Capacity needs cycles`), and `tracker.scope.project: none` (`deliverables` and `status_update` absent with `Set tracker.scope.project with /pmkit:setup`). In `tracker.test.mjs`: every new operation runs through `guarded` (a broken mapping stops it), and no operation of these families is still the stub.
- [ ] **Step 2: Run** the two test files. Expected: new cases fail.
- [ ] **Step 3: Implement**, then set the contract families to `['discovery', 'issues', 'relations', 'history', 'cycles', 'deliverables', 'milestones', 'milestone-writes']` and give the contract fake `project.iterations` with no iteration (the suite opens its own through `openCycle`) and `mappings.fields.sprint: 'project:Sprint'`.
- [ ] **Step 4: Run** `node --test scripts/lib/github/contract.test.mjs scripts/lib/github/*.test.mjs`. Expected: PASS. A contract test that fails because GitHub differs from Local is a bug here unless the spec says otherwise; do not skip it without a line in the spec.
- [ ] **Step 5: Commit** `feat: wire the GitHub cycles, epics and milestones into the tracker (PMK-88)`.

### Task 12: CLI, runbook, E2E test and docs

**Files:**
- Create: `docs/runbooks/cycles-epics-github.md`, `scripts/runbook-cycles-epics-github.test.mjs`
- Modify: `scripts/cli-issues-github.test.mjs` (or a new `scripts/cli-cycles-epics-github.test.mjs`), `README.md`, `CHANGELOG.md`, `CONTEXT.md` only if a term changes

- [ ] **Step 1: Write the CLI cases** over the fake through the CLI entry the PMK-87 tests use: `cycle list`, `cycle current`, `cycle open --start 2026-11-30` (github.com) and its GHES refusal, `cycle close` refusal, `cycle add 12 --to current`, `milestone list`, `milestone create v2 --due 2026-12-31`, `epic create --title Search --start 2026-11-17 --target 2026-12-15`, `epic list`, `epic get acme/12`, `epic update-status acme/12 --health at_risk --body-file <file>`, `epic updates acme/12`, `issues parent 12 acme/12`, `capabilities`.
- [ ] **Step 2: Run** them. Expected: fail before wiring is complete, pass after; fix what fails.
- [ ] **Step 3: Write the runbook** in the format of `docs/runbooks/issues-github.md`: setup with a sprint field, plan a sprint, move issues, create an epic with dates, publish an update, create a milestone and put an issue in it. Add a "Manual live check" section for `openCycle` on a throwaway Project on github.com, marked as not run by the E2E test (follow-up for PMK-335).
- [ ] **Step 4: Write the E2E test** that runs the runbook's commands against the fake gh fixture, as `scripts/runbook-issues-github.test.mjs` does.
- [ ] **Step 5: Update docs**: README GitHub section (what works, what is `NOT_SUPPORTED` and why), CHANGELOG entry under the unreleased version.
- [ ] **Step 6: Run** `node --test scripts/runbook-cycles-epics-github.test.mjs scripts/runbook-setup-github.test.mjs scripts/runbook-issues-github.test.mjs`. Expected: PASS.
- [ ] **Step 7: Commit** `docs: add the GitHub cycles and epics runbook, its E2E test and the README and changelog entries (PMK-88)`.

### Task 13: full check

- [ ] **Step 1: Run** `npm test`. Expected: every test passes but the PMK-333 failures listed in Global constraints.
- [ ] **Step 2:** Fix any other failure with `superpowers:systematic-debugging`, then rerun.
- [ ] **Step 3:** Run the three GitHub runbooks again and record the totals for the report.
