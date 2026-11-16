# PMK-87 GitHub issues, relations, history and search: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GitHub tracker implements the Issues, Relations, History, Comments and search operations of the contract, and `moveToCategory` sets the Status option and opens or closes the issue.

**Architecture:** Pure modules under `scripts/lib/github/` map GitHub nodes to pmkit shapes (ids, issues, writes, filter, history), `documents.mjs` holds every GraphQL document, and three operation modules (`issue-ops`, `relation-ops`, `history-ops`) run them through `createGithubClient`. `tracker.mjs` wires them behind a discovery cache and a mapping check. A stateful fake GitHub (`scripts/fake-github-issues.mjs`) answers the documents in unit tests, the contract suite and the runbook's E2E test.

**Tech stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/specs/2026-11-16-pmk-87-github-issues-relations-history-design.md` (approved 2026-11-16). Read it before any task; this plan does not repeat its tables.

## Global constraints

- No new dependency. Tests use `node:test` and `node:assert/strict`.
- No test starts a real `gh` or opens a socket. Unit tests inject `exec` from `fakeGithubIssues(...).exec`.
- pmkit never reads, prints or stores a token. No test fixture or log may hold `GH_TOKEN`'s value.
- Every commit message carries `PMK-87` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prose in docs, errors and comments follows `~/.claude/skills/unslop/SKILL.md`: no em dashes, sentence-case headings, active voice, plain words.
- Error messages and next steps use the exact text the spec gives where it gives one.
- Every GraphQL document starts with its operation (`query PmkitX(` or `mutation PmkitX(`); fragments come after it, because `operationOf` in `scripts/fake-github-api.mjs` reads only the first definition.
- `scripts/fake-gh.mjs` must not change. `scripts/fake-github-api.mjs` keeps its current behavior for every existing caller.
- Local and Linear outputs stay byte-identical: `node --test scripts/goldens.test.mjs` passes after every task.
- Known failures on this machine, not yours (PMK-333): `github-host` "default exec throws ENOENT", two `cli-pr` tests ("no current branch (detached HEAD)"), the `validate-views` case-clash test.

## Review focus

1. An issue of another repository (`acme/other#5`) as a blocker, parent or child: reads must show `acme/other#5`, and `updateIssue` on it must refuse with `INVALID_INPUT`. Tests in Task 1 (ids) and Task 9 (relations).
2. An issue that has no item in the Project (created on GitHub's web UI): it reads `todo` when open, `moveToCategory` adds it to the Project first, `archive` refuses with the spec's message. Tests in Task 6 and Task 8.
3. A closed issue moved to the other terminal category (`done` to `canceled`): reopened, then closed with the new reason. Test in Task 8.
4. A GHES 3.19 host: no `relatesTo` and no `issueFieldValues` in any document, `link related` refused, a field mapped `issue:` refused. Tests in Task 3 (documents) and Task 9.
5. `searchIssues({ categories: ['done'] })` must find an open issue whose option maps to `done` (no `states: [CLOSED]` narrowing). Test in Task 7.

---

## Schema reference (GHES 3.19 unless marked)

- Event fields: `RenamedTitleEvent { actor createdAt previousTitle currentTitle }`, `LabeledEvent/UnlabeledEvent { actor createdAt label { name } }`, `AssignedEvent/UnassignedEvent { actor createdAt assignee { ... on User { login } } }`, `ClosedEvent { actor createdAt stateReason }`, `ReopenedEvent { actor createdAt }`, `BlockedByAddedEvent/BlockedByRemovedEvent { actor createdAt blockingIssue { number repository { nameWithOwner } } }`, `BlockingAddedEvent/BlockingRemovedEvent { blockedIssue }`, `ParentIssueAddedEvent/ParentIssueRemovedEvent { parent }`, `SubIssueAddedEvent/SubIssueRemovedEvent { subIssue }`, `MarkedAsDuplicateEvent/UnmarkedAsDuplicateEvent { canonical { ... on Issue { number repository { nameWithOwner } } } }`, `IssueTypeAddedEvent/IssueTypeRemovedEvent { issueType { name } }`, `IssueTypeChangedEvent { prevIssueType { name } issueType { name } }`, `IssueComment { id author { login } body createdAt }`. 3.21+ and github.com: `ProjectV2ItemStatusChangedEvent { actor createdAt previousStatus status project { id } }`. `actor { login }` on all.
- Mutation inputs: `createIssue { repositoryId title body assigneeIds labelIds issueTypeId parentIssueId }`, `updateIssue { id title body assigneeIds labelIds issueTypeId }`, `closeIssue { issueId stateReason duplicateIssueId }`, `reopenIssue { issueId }`, `addProjectV2ItemById { projectId contentId }` (returns `item { id }`, and the existing item when the issue is already there), `updateProjectV2ItemFieldValue { projectId itemId fieldId value { singleSelectOptionId | number | date } }`, `clearProjectV2ItemFieldValue { projectId itemId fieldId }`, `archiveProjectV2Item { projectId itemId }`, `deleteIssue { issueId }`, `addBlockedBy/removeBlockedBy { issueId blockingIssueId }`, `addSubIssue { issueId subIssueId replaceParent }`, `removeSubIssue { issueId subIssueId }`, `unmarkIssueAsDuplicate { duplicateId canonicalId }`, `addComment { subjectId body }`, `createLinkedBranch { issueId repositoryId name oid }`. github.com and GHE.com only: `addRelatesTo/removeRelatesTo { issueId relatedIssueId }`. 3.21+ and github.com: `setIssueFieldValue { issueId issueFields: [{ fieldId singleSelectOptionId | numberValue | dateValue | delete }] }`.
- Payloads (checked by live introspection on github.com, 2026-11-16): `addComment { commentEdge { node } }`, `unmarkIssueAsDuplicate { duplicate }`, `addBlockedBy/removeBlockedBy { issue blockingIssue }`, `addSubIssue/removeSubIssue { issue subIssue }`, `updateProjectV2ItemFieldValue/clearProjectV2ItemFieldValue { projectV2Item }`, `addProjectV2ItemById/archiveProjectV2Item { item }`, `createLinkedBranch { issue linkedBranch }`, `addRelatesTo/removeRelatesTo { issue relatedIssue }`, `closeIssue/reopenIssue/createIssue/updateIssue { issue }`, `deleteIssue { repository }`, `setIssueFieldValue { issue }`.
- Reads: `repository.issue(number)`, `repository.issues(first, after, orderBy: { field: CREATED_AT, direction: ASC }, filterBy: { states, assignee, labels, type, since })`, `repository.assignableUsers(first, after) { nodes { id login name } }`, `repository.ref(qualifiedName: "refs/heads/<base>") { name target { oid } }`, `node(id)`, `nodes(ids)`, `ProjectV2Item.fieldValueByName(name)` returning `ProjectV2ItemFieldSingleSelectValue { name optionId }`, `ProjectV2ItemFieldNumberValue { number }`, `ProjectV2ItemFieldDateValue { date }`; `Issue.issueFieldValues` returning `IssueFieldSingleSelectValue { optionId name field { ... on IssueFieldSingleSelect { name } } }`, `IssueFieldNumberValue { value field { name } }`, `IssueFieldDateValue { value field { name } }`.

## Host features

One object decides every per-host branch. Task 3 defines it; every later task takes it from `context.features`.

```js
// scripts/lib/github/documents.mjs
export function hostFeatures({ host, ghesVersion }) // => { issueFields, relatesTo, statusEvents }
// github.com and *.ghe.com: all true. GHES: issueFields and statusEvents from 3.21, relatesTo false.
```

---

### Task 1: shared criteria parser and GitHub ids

**Files:**
- Create: `scripts/lib/body-criteria.mjs`, `scripts/lib/body-criteria.test.mjs`, `scripts/lib/github/ids.mjs`, `scripts/lib/github/ids.test.mjs`
- Modify: `scripts/lib/linear/issues.mjs` (move `CRITERIA_HEADING`, `parseDescription`, `buildDescription` out; re-export them)

**Interfaces:**
- Produces: `parseDescription(text) -> { description, acceptanceCriteria }`, `buildDescription(description, criteria) -> string`, `CRITERIA_HEADING` from `scripts/lib/body-criteria.mjs`; Linear imports keep working through the re-export.
- Produces: `parseIssueId(value, scopeRepo) -> { repo: 'owner/name', number: int } | null`, `isIssueId(value) -> boolean`, `issueIdOf({ number, repository: { nameWithOwner } }, scopeRepo) -> string`, `compareGithubIds(a, b) -> number`, `notFound(id) -> PmkitError` (`NOT_FOUND`, `issue <id> does not exist`, next step `pmkit issues list`).

- [ ] **Step 1: Write the failing tests.** `body-criteria.test.mjs`: move the criteria cases of `scripts/lib/linear/issues.test.mjs` here unchanged (they still pass through the re-export there too). `ids.test.mjs`:

```js
assert.deepEqual(parseIssueId('12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
assert.deepEqual(parseIssueId('#12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
assert.deepEqual(parseIssueId('Acme/Widgets#12', 'acme/widgets'), { repo: 'acme/widgets', number: 12 })
assert.deepEqual(parseIssueId('acme/other#5', 'acme/widgets'), { repo: 'acme/other', number: 5 })
for (const bad of ['', '0', '012', '-1', 'ISS-12', 'acme/other/5', 'acme#5', '12a', ' 12']) assert.equal(parseIssueId(bad, 'acme/widgets'), null)
assert.equal(issueIdOf({ number: 12, repository: { nameWithOwner: 'ACME/widgets' } }, 'acme/widgets'), '12')
assert.equal(issueIdOf({ number: 5, repository: { nameWithOwner: 'acme/other' } }, 'acme/widgets'), 'acme/other#5')
assert.deepEqual(['10', 'acme/other#5', '2'].sort(compareGithubIds), ['2', '10', 'acme/other#5'])
```

- [ ] **Step 2: Run** `node --test scripts/lib/body-criteria.test.mjs scripts/lib/github/ids.test.mjs`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement.** Move the three exports verbatim; `scripts/lib/linear/issues.mjs` does `export { CRITERIA_HEADING, parseDescription, buildDescription } from '../body-criteria.mjs'` and imports them for its own use. Ids: the number has no leading zero; owner and name follow `parseRepo` in `discovery.mjs`; the scope comparison ignores case and returns the scope's spelling. `compareGithubIds`: plain numbers first, by value; then `owner/name#n` by repo text, then number.
- [ ] **Step 4: Run** the two tests plus `node --test scripts/lib/linear/issues.test.mjs scripts/goldens.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: share the criteria parser and add GitHub issue ids (PMK-87)`.

### Task 2: the `threads` family in the contract suite

**Files:**
- Modify: `scripts/contract-suite.mjs`, `scripts/lib/linear/contract.test.mjs`

**Interfaces:**
- Produces: `FAMILIES` includes `'threads'` right after `'history'`. The test "lists, replies to and resolves comment threads" needs `['history', 'threads']`.

- [ ] **Step 1:** Change the test's family list and `FAMILIES`; add `'threads'` to the Linear `families` array. Update the header comment of the suite to name the family.
- [ ] **Step 2: Run** `node --test scripts/contract.test.mjs scripts/lib/linear/contract.test.mjs`. Expected: PASS with the same number of tests run as before (no new skips).
- [ ] **Step 3: Commit** `test: split the threads family out of history in the contract suite (PMK-87)`.

### Task 3: the GraphQL documents

**Files:**
- Create: `scripts/lib/github/documents.mjs`, `scripts/lib/github/documents.test.mjs`

**Interfaces:**
- Produces: `hostFeatures({ host, ghesVersion })` (see "Host features").
- Produces: `issueDocuments(features, projectFields)` where `projectFields` is `{ status?: true, priority?: true, estimate?: true, due?: true }` (which aliases the fragment carries). It returns an object of strings:
  - `ISSUE` `query PmkitIssue($owner: String!, $name: String!, $number: Int!, <field vars>) { repository(owner, name) { issue(number) { ...PmkitIssueFields } } }`
  - `ISSUES` `query PmkitIssues($owner, $name, $first: Int!, $after: String, $filterBy: IssueFilters, <field vars>)` over `repository.issues(... orderBy: { field: CREATED_AT, direction: ASC })` with `pageInfo { hasNextPage endCursor }`
  - `MORE(connection)` `query PmkitIssueMore_<connection>($id: ID!, $first: Int!, $after: String)` for `labels`, `subIssues`, `blockedBy`, `blocking`, `relatesTo`
  - `TIMELINE` `query PmkitTimeline($id: ID!, $first: Int!, $after: String, $since: DateTime, $itemTypes: [IssueTimelineItemsItemType!])`
  - `TIMELINES` `query PmkitTimelines($ids: [ID!]!, $since: DateTime, $itemTypes: [...])`, `timelineItems(first: 100)` per node
  - `COMMENTS` `query PmkitComments($id: ID!, $first: Int!, $after: String)`
  - `BRANCH_HEAD` `query PmkitBranchHead($owner, $name, $qualifiedName: String!)` returning `repository { id ref(qualifiedName: $qualifiedName) { name target { oid } } }` (this replaces the first draft's `DEFAULT_BRANCH`; see the correction note in Task 8)
  - `ASSIGNABLE_USERS` `query PmkitAssignableUsers($owner, $name, $first: Int!, $after: String)`
  - mutations `PmkitCreateIssue`, `PmkitUpdateIssue`, `PmkitCloseIssue`, `PmkitReopenIssue`, `PmkitAddProjectItem`, `PmkitSetProjectField`, `PmkitClearProjectField`, `PmkitSetIssueField` (only when `features.issueFields`), `PmkitArchiveItem`, `PmkitDeleteIssue`, `PmkitAddBlockedBy`, `PmkitRemoveBlockedBy`, `PmkitAddRelatesTo` and `PmkitRemoveRelatesTo` (only when `features.relatesTo`), `PmkitUnmarkDuplicate`, `PmkitAddSubIssue`, `PmkitRemoveSubIssue`, `PmkitAddComment`, `PmkitCreateLinkedBranch`. Each takes `$input: <Type>Input!` and selects what the op modules need (`issue { id number }`, `item { id }`, `comment { id author { login } body createdAt }`, `linkedBranch { ref { name } }`).
  - `ITEM_TYPES(features)`: the timeline item types of the spec's history table, with `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` only when `features.statusEvents`.
- Field values come through variables, never literals: `status: fieldValueByName(name: $fStatus)`, `fPriority: fieldValueByName(name: $fPriority)`, `fEstimate: ...$fEstimate`, `fDue: ...$fDue`, each declared `String!` only when its alias is present. Issue reads need no `$projectId`: the fragment reads `project { id }` on each item.
- The fragment selects the fields of the spec's "The issue fragment", with `relatesTo` only when `features.relatesTo` and `issueFieldValues` only when `features.issueFields`. Each nested issue reference selects `id number state stateReason repository { nameWithOwner }`, and `blockedBy` nodes also select the configured Project's status through `projectItems(first: 20) { nodes { project { id } status: fieldValueByName(name: $fStatus) { ... } } }` when `status` is present, so `blocked` reads without another call.

- [ ] **Step 1: Write the failing tests.** For github.com features and GHES 3.19 features: every document parses as one operation whose name is as listed (use `operationName` from `scripts/lib/graphql.mjs`); `isMutation` is true exactly for the mutations; the GHES 3.19 set has no `relatesTo`, no `issueFieldValues`, no `PmkitSetIssueField`, and `ITEM_TYPES` lacks `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT`; a fragment never comes first; `hostFeatures({ host: 'github.com', ghesVersion: null })` is all true, `{ host: 'git.acme.dev', ghesVersion: '3.21.0' }` gives `{ issueFields: true, relatesTo: false, statusEvents: true }`, `'3.19.2'` all false; with `projectFields: { status: true }` the ISSUE document declares `$fStatus: String!` and no `$fPriority`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/documents.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** with template strings; reuse `hasIssueFields` and `compareVersions` from `discovery.mjs`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the GraphQL documents of the GitHub issue operations (PMK-87)`.

### Task 4: the stateful fake GitHub

**Files:**
- Create: `scripts/fake-github-issues.mjs`, `scripts/fake-github-issues.test.mjs`
- Modify: `scripts/fake-github-api.mjs` (one hook, below)

**Interfaces:**
- Consumes: the operation names and variable shapes of Task 3.
- Produces: `fakeGithubIssues({ host = 'github.com', ghesVersion = null, repo = 'acme/widgets', project = { id: 'PVT_1', owner: 'acme', number: 7, statusOptions: [...], fields: [...] } | null, issueFields = [...], issueTypes = [...], labels = [...], users = [{ id, login, name }], viewer = 'octocat', defaultBranch = { name: 'main', oid: 'c0ffee...' }, now }) -> { state, exec, handle(name, variables, query), mutations, reads, seed(issue), toJSON() }` and `fakeGithubIssuesFrom(json)` that restores it. `exec(cmd, args, { input })` answers like `answerGh`: `PmkitRepo`, `PmkitProject` and `PmkitLinkedProjects` from the same state (built with `repoReply`/`projectReply` shapes extended by Task 5's fields), and every Task 3 operation from the state.
- Produces: in `answerGh`, when `fixture.graphql[name]` is missing and `fixture.issues` is set, the reply comes from `fakeGithubIssuesFrom(fixture.issues).handle(...)`, and the fixture's `issues` key is replaced by the new state (the E2E wrapper writes the fixture back). Existing fixtures without `issues` behave as today.

Behavior to implement (the spec's "Facts" and "Contract suite against the fake"):
- Issues get numbers 1, 2, 3 in creation order and node ids `I_<n>`; comments `IC_<n>`; items `PVTI_<n>`. `createdAt` and `updatedAt` come from `now()`, which advances one second per mutation, so history sorts.
- Every mutation appends to `mutations` and records the timeline events GitHub would: create, rename, label, assign, close (with `stateReason`), reopen, type, blocked-by and blocking on both issues, parent and sub-issue on both, duplicate, comment, and a status change event when `statusEvents` is on.
- `addProjectV2ItemById` returns the existing item when there is one. `closeIssue` with `DUPLICATE` sets `duplicateOf`. `deleteIssue` removes the issue and every link to it.
- A document that mentions `relatesTo` or `issueFieldValues` on a host without that feature, or an unknown operation name, answers `{ errors: [{ message: "Field 'relatesTo' doesn't exist on type 'Issue'" }] }` (no `type`, which the client reads as a rejected query).
- `repository.issues` applies `filterBy.states`, `assignee`, `labels` (any), `type`, `since` (updatedAt >= since), pages by `first` and `after` (the cursor is the index as a string).
- `fieldValueByName(name: $fX)` aliases resolve from the item's values by field name.

- [ ] **Step 1: Write the failing tests:** create two issues, read them back by `PmkitIssue` and `PmkitIssues`, close one as `NOT_PLANNED`, page with `first: 1`, add a blocker and read `blockedBy` and `blocking` on both issues, check the timeline of a renamed issue, check that a GHES 3.19 fake rejects a document with `relatesTo`, check `toJSON` round trip through `fakeGithubIssuesFrom`, and that `answerGh` with a fixture lacking `issues` still answers `PmkitRepo` from `fixture.graphql`.
- [ ] **Step 2: Run** `node --test scripts/fake-github-issues.test.mjs scripts/runbook-setup-github.test.mjs`. Expected: the new tests FAIL, the runbook test PASSES.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `test: add a stateful fake GitHub for the issue operations (PMK-87)`.

### Task 5: discovery, cache, mapping check and manifest

**Files:**
- Modify: `scripts/lib/github/discovery.mjs`, `scripts/lib/github/discovery.test.mjs`, `scripts/lib/github/tracker.mjs`, `scripts/lib/github/tracker.test.mjs`, `scripts/fake-github-api.mjs` (`repoReply` gains the new fields)
- Create: `scripts/lib/github/manifest.mjs`, `scripts/lib/github/manifest.test.mjs`

**Interfaces:**
- Produces: raw discovery gains `repositoryId`, `viewer.id` (node id), `labels: [{ id, name }]` (was names; update every reader, including `discoveryView`'s `labels` list of names), `users: [{ id, login, name }]` from `PmkitAssignableUsers` paged with `client.paginate` (`pageSize: 100`, cap 10 pages), and `features` from `hostFeatures`. `discoveryView(raw).members` lists the users as `{ id: login, name, email: null }`, viewer first when missing.
- Produces: in `tracker.mjs`, `discovery({ refresh }) -> Promise<{ raw, fresh: boolean }>` with the memo, `cacheGet`/`cachePut` (scope `repoHash(config.root)`, key `github-<host>-<repo>`, TTL 3600 s, a raw value is accepted only when `version === 1` and `Array.isArray(users)`), and `guarded(body)` that runs the scope check, then `brokenGithubMappings` with one refresh on a cached miss, then `body`. The error is `NOT_CONFIGURED` with the spec's message, next step `/pmkit:setup`, and `{ mappings: broken }`.
- Produces: `buildGithubCapabilities(raw, pmkit) -> entries[]` per the spec's capabilities table; `capabilities()` uses it.

- [ ] **Step 1: Write the failing tests:** `discover().members` has three users from two pages of assignable users; a second `createGithubTracker` with the same `PMKIT_HOME` reads discovery from the cache (no `PmkitRepo` call in `fake.reads`) while `discover()` itself always reads GitHub; a mapping `mappings.status.done: Gone` makes a guarded stub fail with `NOT_CONFIGURED` and `details.mappings[0].path === 'mappings.status.done'`, after one refresh from a cached discovery; the manifest marks `estimation` native with `{ unit: 'points', scale: [] }` when `estimate: issue:Effort`, absent with `Map an estimate field with /pmkit:setup` when `none`; `dependencies.detail.unsupported` is `['related']` on GHES only; `unservedCapabilities(entries, SERVED_BY)` is empty.
- [ ] **Step 2: Run** `node --test scripts/lib/github/*.test.mjs scripts/runbook-setup-github.test.mjs scripts/cli-github-init.test.mjs`. Expected: new tests FAIL.
- [ ] **Step 3: Implement**, mirroring `scripts/lib/linear/tracker.mjs` (`readCache`, `fetchFresh`, `discovery`, `checkMappings`, `guarded`).
- [ ] **Step 4: Run** the same command. Expected: PASS. The runbook test's step-5 capabilities assertion changes in Task 13, so if it fails here only on that assertion, update the assertion to the new manifest now and the runbook text in Task 13.
- [ ] **Step 5: Commit** `feat: cache GitHub discovery, check mappings before each operation, and list assignable users (PMK-87)`.

### Task 6: the issue model

**Files:**
- Create: `scripts/lib/github/issues.mjs`, `scripts/lib/github/issues.test.mjs`

**Interfaces:**
- Consumes: `parseDescription`, `issueIdOf`, `compareGithubIds`, `statusFieldOf`, `fieldOf`, `parseFieldSource`.
- Produces: `makeContext(raw, pmkit) -> { raw, pmkit, repo, project: { id, statusField, options } | null, features, categoryOfOption(name) -> category, optionOf(category) -> { id, name } | null, typeOf(issueTypeName) -> pmkit type | undefined, issueTypeOf(type) -> { id, name } | undefined, field(role) -> { source: 'issue'|'project', field } | null, projectFields: { status?, priority?, estimate?, due? }, fieldVariables: { fStatus?, fPriority?, fEstimate?, fDue? }, priorities }`. Roles: `priority`, `estimate`, `due` reads `mappings.fields.target_date`.
- Produces: `statusOf(node, context) -> { name, category }` (the settled rule), `priorityRule(options) -> Map<optionName, priority>` and `optionForPriority(options, priority) -> option | undefined`, `itemOf(node, context) -> item | null` (the configured Project's item), `toIssue(node, context) -> Issue` per the spec's model table, `isBlockedNode(node, context) -> boolean` (a `blockedBy` node not in a terminal category by the same rule).

- [ ] **Step 1: Write the failing tests**, one per row of the model table and the status rule:
  - closed `COMPLETED` with option `In Progress` reads `done`; closed `NOT_PLANNED` and `DUPLICATE` read `canceled`; open with option `Done` reads `done` (settled rule); open with no item reads `{ name: 'Open', category: 'todo' }`; open with an option no category names reads `in_progress`; with `project: null`, open reads `Open`/`todo` and closed `Closed`/`done` or `canceled`.
  - priority: options `P0..P3` read `urgent..low`; options `Low, High` read by name; a fifth option reads unset.
  - estimate from `IssueFieldNumberValue { value: 3 }` is `3`; from a Project single select `M` is `'M'`; `due` from `ProjectV2ItemFieldDateValue { date: '2026-12-01' }`.
  - `archived` true only when the configured Project's item has `isArchived: true`; an item of another Project is ignored.
  - `blockedBy` lists `acme/other#5` and `3`, sorted `['3', 'acme/other#5']`; `branch` is the first linked branch; `type` maps `Bug` to `bug`; the body's criteria split out.
- [ ] **Step 2: Run** `node --test scripts/lib/github/issues.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pure functions, no client.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat: map GitHub issue nodes to pmkit issues (PMK-87)`.

### Task 7: search and reads

**Files:**
- Create: `scripts/lib/github/filter.mjs`, `scripts/lib/github/filter.test.mjs`, `scripts/lib/github/issue-ops.mjs`, `scripts/lib/github/issue-ops.test.mjs`

**Interfaces:**
- Consumes: Task 3 documents, Task 6 `makeContext`, `toIssue`, `isBlockedNode`; `checkFilter`, `issueComparator` from `scripts/lib/issue-filter.mjs`.
- Produces: `translateFilter(filter, context, viewerLogin) -> { variables: { filterBy }, clientSteps: [(issue, node) => boolean], sort, limit, serverLimit: number | undefined, empty: boolean }`.
- Produces: `issueOperations({ client, discovery, config, context: async () => context }) -> { getIssue(id), searchIssues(filter), readNode(id) -> { node, issue }, ...later tasks }`. `readNode` resolves another repository's id through its own `repository(owner, name)` and reads the remaining nested pages with `MORE(connection)` before mapping.

- [ ] **Step 1: Write the failing tests.** `filter.test.mjs`, one assertion per row of the spec's search table, including review focus 5 (`categories: ['done']` sets no `states`), `categories: ['todo','in_progress']` sets `states: ['OPEN']`, `assignee: 'me'` uses the viewer login, `assignee: 'none'` is a client step, one type sets `filterBy.type: 'Bug'`, two types do not, `updatedAfter` sets `since` and a client step, `sprint` and `release` throw `NOT_SUPPORTED`, `categories: []` gives `empty: true`, `serverLimit` only for `sort: 'created'` without client steps. `issue-ops.test.mjs` against the fake: `getIssue('99')` and `getIssue('ISS-1')` throw `NOT_FOUND` (the second with no request), `getIssue('acme/other#5')` reads the other repository, a search returns oldest first, `archived` items drop out unless `archived: true`, `blocked: true` keeps only issues with an open blocker, 120 issues give two pages and `hasMore: false`, a cap of 10 pages gives `hasMore: true`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/filter.test.mjs scripts/lib/github/issue-ops.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat: search and read GitHub issues through repository.issues (PMK-87)`.

### Task 8: issue writes, moves, archive and delete

**Files:**
- Create: `scripts/lib/github/writes.mjs`, `scripts/lib/github/writes.test.mjs`
- Modify: `scripts/lib/github/issue-ops.mjs`, `scripts/lib/github/issue-ops.test.mjs`

**Interfaces:**
- Consumes: Task 6, Task 7 `readNode`.
- Produces: `planWrite(patch, { mode: 'create'|'update', before, context }) -> { input, fields: [{ role, value }], after }` that throws every `INVALID_INPUT` and `NOT_SUPPORTED` of the spec's writes table before any request.
- Produces on `issueOperations`: `createIssue(input, actor, { dryRun })`, `updateIssue(id, patch, actor, { dryRun })`, `assign(id, who, actor, { dryRun })`, `moveToCategory(id, category, actor, { status, dryRun })`, `archive(id, actor, { dryRun })`, `delete(id, actor, { dryRun })`, `requireActor(actor)` (the viewer check with the spec's message). All return `{ before, after }` (`before: null` on create, `after: null` on delete, dry-run `after.id: null` on create).

- [ ] **Step 1: Write the failing tests** against the fake, with `fake.mutations` checked:
  - `createIssue({ title: 'A', type: 'bug', labels: ['bug'], acceptanceCriteria: [{ text: 'x', done: false }], priority: 'high', status: 'In Progress' })` sends `PmkitCreateIssue`, `PmkitAddProjectItem`, the field write and `PmkitSetProjectField` in that order, and reads back `in_progress`; the dry run sends none.
  - A failure of the field write after the create throws `UPSTREAM` whose message starts `GitHub created issue 1, but`.
  - `updateIssue` with no change sends nothing; `priority: null` sends `PmkitClearProjectField`; `sprint: 'x'` throws `NOT_SUPPORTED`; a field mapped `none` throws `NOT_SUPPORTED`; another repository's issue throws `INVALID_INPUT` `pmkit writes issues of acme/widgets only`; an unknown label refreshes once, then `INVALID_INPUT`.
  - `branch`: equal to the linked branch sends nothing; a new name with `{ base: 'develop' }` reads `PmkitBranchHead` for `refs/heads/develop` and sends `PmkitCreateLinkedBranch` with that oid, in a fake whose GitHub default branch is `main` and whose `develop` head differs (the coordinator's test); `{ base: 'feature' }` that GitHub lacks falls back to pmkit's default branch (`git_host.default_branch`, else `main`) and returns the spec's note; no branch on GitHub at all throws `INVALID_INPUT`; a second, different name throws `INVALID_INPUT` `GitHub links 1 to branch <name> already`.
  - Correction note (coordinator, 2026-11-16): the linked branch starts at the GitHub head of the branch `issues branch` starts from, passed as `options.base`, never at `defaultBranchRef`. Task 3 shipped `DEFAULT_BRANCH`; Task 8 replaces it with `BRANCH_HEAD` in `documents.mjs` and the fake.
  - `moveToCategory`: each row of the spec's steps, including `done` (option, then `PmkitCloseIssue` with `COMPLETED`), `canceled` mapped `none` (close `NOT_PLANNED`, option unchanged), `in_review` unmapped (`NOT_SUPPORTED`, `no Status option of acme/7 stands for in_review`), an issue with no item (adds it first), review focus 3 (`done` closed to `canceled`: reopen then close), already in place (no mutation), `status: 'Todo'` for `done` (`INVALID_INPUT`), `project: none` for `in_progress` (`NOT_SUPPORTED`).
  - `assign`: `me` assigns the viewer; an unknown login refreshes once then `INVALID_INPUT`; `null` sends `assigneeIds: []`.
  - `archive`: sends `PmkitArchiveItem`; no item gives `INVALID_INPUT` (review focus 2); `project: none` gives `NOT_SUPPORTED`.
  - `delete`: refused with `CONFLICT` while it blocks another issue; else `PmkitDeleteIssue`.
  - actor `fred` (not the viewer) on any write: `INVALID_INPUT` `GitHub records every write as the gh login (octocat)`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/writes.test.mjs scripts/lib/github/issue-ops.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat: create, update, move, assign, archive and delete GitHub issues (PMK-87)`.

### Task 9: relations

**Files:**
- Create: `scripts/lib/github/relation-ops.mjs`, `scripts/lib/github/relation-ops.test.mjs`

**Interfaces:**
- Consumes: `issueOperations` (`readNode`, `requireActor`).
- Produces: `relationOperations({ client, ops, context }) -> { link(from, to, kind, actor, { dryRun }), unlink(from, to, kind, actor, { dryRun }), setParent(id, parent, actor, { dryRun }) }`, each `{ before, after }` of the first issue, `link` with `notes: ['GitHub closed <a> as a duplicate of <b>']` for `duplicate`.

- [ ] **Step 1: Write the failing tests:** each row of the spec's relations table against the fake; an existing link and a missing unlink send nothing; a self link and kind `sibling` give `INVALID_INPUT`; a blocks loop `1 → 2 → 1` and a parent loop give `INVALID_INPUT` with the loop text; `related` on a GHES 3.19 fake gives `NOT_SUPPORTED` `GitHub Enterprise Server has no related issues` with no request sent; a blocker in `acme/other` links and reads back as `acme/other#5` (review focus 1); `setParent(id, null)` sends `PmkitRemoveSubIssue` for the current parent.
- [ ] **Step 2: Run** `node --test scripts/lib/github/relation-ops.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `feat: link, unlink and parent GitHub issues (PMK-87)`.

### Task 10: history, comments and metric events

**Files:**
- Create: `scripts/lib/github/history.mjs`, `scripts/lib/github/history.test.mjs`, `scripts/lib/github/history-ops.mjs`, `scripts/lib/github/history-ops.test.mjs`

**Interfaces:**
- Produces: `toEvents(node, items, context) -> Event[]` (pure, one row of the spec's history table per item type, sorted by `at`), `toComment(node, issueId) -> Comment`.
- Produces: `historyOperations({ client, ops, context }) -> { getHistory(id, { since }), listComments(id), comment(id, body, actor, { replyTo, dryRun }), resolveThread(), metricEvents({ since, until }) }`. `replyTo` and `resolveThread` throw `NOT_SUPPORTED` `GitHub issue comments have no threads`, next step `Post a new comment with pmkit issues comment`. `getHistory` on a host without `statusEvents` returns the events with a non-enumerable `warnings` property holding `on GitHub Enterprise Server before 3.21, Status option changes have no events, so moves show only as opens and closes`.

- [ ] **Step 1: Write the failing tests:** `toEvents` for each row (title rename to `update` with `from`/`to`, label add and remove, type change to the pmkit type, assign, close `NOT_PLANNED` to `move` to `canceled`, status change event to `move` between two categories, blocked-by added to `link` field `blockedBy`, sub-issue added to `link` field `children`, a deleted actor to `by: null`); ops against the fake: create, rename, comment gives ops `['create', 'update', 'comment']`; `comment(id, '  ')` is `INVALID_INPUT`; `metricEvents` over 25 issues sends one `PmkitIssues` read and two `PmkitTimelines` reads and tags each event with `issue`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/history.test.mjs scripts/lib/github/history-ops.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read GitHub issue history and comments (PMK-87)`.

### Task 11: tracker wiring, adapter settings and the contract suite

**Files:**
- Modify: `scripts/lib/github/tracker.mjs`, `scripts/lib/github/tracker.test.mjs`, `scripts/lib/github/adapter.mjs`, `scripts/adapters.test.mjs`
- Create: `scripts/lib/github/contract.test.mjs`

**Interfaces:**
- Produces: `createGithubTracker` returns every contract operation; the Issues, Relations, History and Comments operations run through `guarded`; `unarchive`, `restore`, `delegate`, `logTime`, `listTimeEntries` throw `NOT_SUPPORTED` with the manifest's hint (or the spec's text for `restore`: `GitHub has no trash, so a deleted issue cannot come back`); every other operation keeps the PMK-86 stub.
- Produces: `githubDescriptor().settings()` returns `{ defaults, epicPrefix: null, isEpicId: (id) => !isIssueId(id), trackerBranch: true, remoteBranch: true }`.

- [ ] **Step 1: Write the failing tests:** `contract.test.mjs` runs `runTrackerContract({ name: 'GitHub tracker contract over the fake', families: ['discovery', 'issues', 'relations', 'history'], setup })` where `setup` builds a fake on github.com with Status options Triage, Backlog, Todo, In Progress, In Review, Done, Canceled, every category mapped, `types: { feature: 'Feature', bug: 'Bug', task: 'Task' }`, `fields: { priority: 'issue:Priority', estimate: 'issue:Effort', target_date: 'issue:Target date', start_date: 'none' }`, a fresh `PMKIT_HOME` from `userStoreEnv()`, `actor: 'octocat'`; `adapters.test.mjs` checks the new settings.
- [ ] **Step 2: Run** `node --test scripts/lib/github/contract.test.mjs scripts/adapters.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring. Fix any adapter defect the suite finds in the module that owns it, with a unit test there.
- [ ] **Step 4: Run** `node --test scripts/lib/github/*.test.mjs scripts/adapters.test.mjs scripts/contract.test.mjs scripts/lib/linear/contract.test.mjs`. Expected: PASS; the GitHub suite skips only tests that need `time`, `threads`, `cycles`, `deliverables`, `milestones`, `releases`, `documents` or `agents`.
- [ ] **Step 5: Commit** `feat: serve the GitHub issue operations through the tracker and run the contract suite (PMK-87)`.

### Task 12: the linked-branch note of `issues branch`

**Files:**
- Modify: `scripts/pmkit.mjs` (`issues branch`, a helper next to `syncNotes`)
- Create: `scripts/cli-github-issues.test.mjs`

**Interfaces:**
- Produces: `issues branch` passes `{ base }` to both `updateIssue` calls: `from` without a leading `origin/`. `linkedBranchNotes(ctx, from, base, created = null) -> string[]`, called only when `ctx.settings().remoteBranch === true`. It runs `git merge-base --is-ancestor refs/remotes/origin/<base> <from>` through `readGit`; status 0 gives `[]`; status 1 gives the spec's note (dry run: `... Pass --from origin/<default>`; real run: `... Run git fetch origin, then git rebase --onto origin/<default> <from> <branch>`); no `origin/<default>` gives `[]`; any other failure gives `could not check whether <from> contains origin/<default>, so the push of pr open may be refused. Run git fetch origin, then check with git log <from>..origin/<default>`.

- [ ] **Step 1: Write the failing tests** (CLI run in-process as `scripts/cli-hosted.test.mjs` does, with the GitHub descriptor over the fake and a temp git repo with a bare origin from `addBareOrigin`): with local `main` behind `origin/main`, `issues branch 1 --dry-run --json` has the note in `notes` and the real run's note names `git rebase --onto origin/main main 1-<slug>`; with `main` level with `origin/main`, no note; with `--from feature` lacking `origin/main`, the note; the real run records `branch` through `PmkitCreateLinkedBranch` and `issues get 1 --json` shows it. A Local tracker run shows no such note.
- [ ] **Step 2: Run** `node --test scripts/cli-github-issues.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `node --test scripts/cli-pr.test.mjs scripts/goldens.test.mjs`. Expected: PASS apart from the two known `cli-pr` failures.
- [ ] **Step 5: Commit** `feat: warn in issues branch when GitHub's linked branch would refuse the push (PMK-87)`.

### Task 13: runbook, E2E test, ADR and glossary

**Files:**
- Create: `docs/runbooks/issues-github.md`, `scripts/runbook-issues-github.test.mjs`, `docs/adr/0008-github-issues-archives-through-the-project-and-links-branches-on-github.md`
- Modify: `docs/runbooks/setup-github.md` (step 5), `scripts/runbook-setup-github.test.mjs`, `CONTEXT.md`

**Interfaces:**
- Consumes: the `fixture.issues` hook of Task 4; the fake-`gh` wrapper of `runbook-setup-github.test.mjs` (copy its `fakeGhOnPath`, and make the wrapper write the fixture back after each call so the state persists).

- [ ] **Step 1: Write the runbook** with the steps the spec's "Runbook" section lists, each with its command (`node scripts/pmkit.mjs issues create --title-file ... --type bug --json`, `issues list --json`, `issues move 1 in_progress --json`, `issues move 1 done --json`, `issues link 2 1 --kind blocks --json`, `issues list --blocked --json`, `issues parent 2 1 --json`, `issues link 3 1 --kind duplicate --json`, `issues comment 1 --body-file ... --json`, `issues history 1 --json`, `issues branch 1 --dry-run --json`, `issues archive 1 --json`) and what to expect. Check the exact flag names against `scripts/pmkit.mjs` `COMMANDS` before writing them.
- [ ] **Step 2: Write the failing E2E test** that runs every runbook command as a subprocess with the fake `gh` first on `PATH`, `GH_TOKEN` set to a fake token, and checks each expectation, that the runbook text names each command, and that no logged call holds the token.
- [ ] **Step 3: Run** `node --test scripts/runbook-issues-github.test.mjs`. Expected: PASS once the runbook and the adapter agree; fix the runbook text, not the test, when they differ.
- [ ] **Step 4:** Update `setup-github.md` step 5 to the new `capabilities` result and its test assertion. Write ADR 0008 (status line per ADR 0006: `Accepted`) recording decisions 2 and 6 with their considered options and consequences. Add the **Linked branch** term to `CONTEXT.md` after **GitHub Project**: a branch that GitHub links to an issue in its Development section; on GitHub Issues, `issues branch` creates it on GitHub at the head there of the branch it starts from, and the issue's `branch` reads it. _Avoid_: issue branch (alone).
- [ ] **Step 5: Run** `node --test scripts/runbook-issues-github.test.mjs scripts/runbook-setup-github.test.mjs scripts/adr*.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit** `docs: add the GitHub issue flows runbook, its E2E test, ADR 0008 and the linked branch term (PMK-87)`.

### Task 14: full check

- [ ] **Step 1: Run** `npm test`. Expected: every test passes but the four known failures.
- [ ] **Step 2:** Fix anything else, with a test, in the module that owns it, and commit with `PMK-87`.
