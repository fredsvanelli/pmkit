# PMK-35 design: issues, relations and search for Linear

Issue PMK-35, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved. The user answered the four questions on 2026-10-27, and "Resolved questions" records the answers. Decisions come from an autonomous brainstorming run on 2026-10-27 with no user dialogue, from the issue, ADR-0001, ADR-0003, ADR-0005, the PMK-30 and PMK-33 specs, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear tracker answers `discover` and `capabilities` and throws `NOT_SUPPORTED` for every other contract operation (`scripts/lib/linear/tracker.mjs`). No command can list, read, create, change or link a Linear issue. Three defects from earlier reviews also land here:

- `me` reaches the adapter unresolved, in `issues list --assignee me` and in `issues assign <id> me`. The Local tracker resolves it; the Linear stubs never see it. ADR-0005 already says the Linear adapter resolves `me` and the actor from `viewer`, not from `git config user.email`.
- `operationName` in `scripts/lib/linear/client.mjs` reads only the first definition, so a document that opens with a fragment has no name. The client then names it "an anonymous query" in errors, and `fakeLinearFetch` routes a named mutation as `(anonymous)`.
- `issues dependencies` decides "epic or issue" from `settings().epicPrefix`. A hosted tracker returns `null`, so the command sends every id to `getIssue`, epic ids included.

Sources:

- Unified model, "Adapter operations contract": the Issues family (`search_issues`, `get_issue`, `create_issue`, `update_issue`, `move_to_category`, `assign`, `archive`, `delete`; "`move_to_category` becomes a transition, project field, custom status or state"), the Native search family ("GitLab and Linear filters"), and the Relations family ("Link types mapped to blocks, related, duplicate").
- Unified model, "Common status categories", Linear column, and the Q6 decision C (infer the unambiguous, ask the ambiguous, re-ask only when a mapping breaks).
- Linear tab, domains 2 (Issues) and 3 (Workflow states), and "Work on issue XXX" step 4 (the branch name Linear suggests).
- The pmkit design spec, "Contract": the operations, `{ before, after }`, `dryRun`, and the structured filter of `searchIssues`.

Acceptance criteria:

1. The adapter implements the Issues and Relations operations of the contract.
2. `move_to_category` sets the workflow state mapped to the category.
3. Issue filters translate to Linear filters.

Bound decisions from earlier issues:

- The client retries only documents with no mutation (PMK-30).
- The client's page cap is 10 pages when the caller gives no limit, and `hasMore` signals the cut (PMK-30, PMK-33).
- Only the client refuses secret-like config keys (PMK-30, PMK-33 resolved question 2).
- Every write appears in Linear as the key's owner, and the adapter resolves `me` and the actor from `viewer` (ADR-0005).

## Facts checked against the Linear API

Read-only calls on 2026-10-27 against the sandbox workspace (Free plan), through `createLinearClient` and a fetch wrapper that refused any document containing `mutation`. No write was sent. Introspection reads the schema; it does not prove that a mutation behaves as its input type suggests.

| Call | Result |
|---|---|
| `__type(IssueFilter)` | Has `id` (`IssueIDComparator`: `eq`, `neq`, `in`, `nin`), `title`, `description`, `searchableContent` (`contains`), `assignee` (`id`, `isMe`, `null`), `labels` (`some`, `every`, `name`), `parent`, `state` (`id`, `name`, `type`, `team`), `team`, `updatedAt`, `createdAt`, `archivedAt`, `hasBlockedByRelations`, `hasBlockingRelations`, `hasRelatedRelations`, `hasDuplicateRelations`, `cycle`, `project`, `and`, `or`. |
| `__type(Query)` | `issues(filter, first, after, includeArchived, orderBy, sort)`, `issue(id)`, `issueSearch`, `searchIssues(term, ...)`. |
| `__type(IssueSortInput)`, `PaginationOrderBy` | `sort` takes `createdAt`, `updatedAt`, `priority`, `dueDate` and more, each with `order: Ascending or Descending` and `nulls`. `orderBy` takes only `createdAt` or `updatedAt`. |
| `issues(first: 5, orderBy: createdAt)` | Newest first. |
| `issues(first: 5, sort: [{ createdAt: { order: Ascending } }])` | Oldest first. |
| `__type(IssueRelationType)` | `blocks`, `duplicate`, `related`, `similar`. No `blocked_by` type. |
| `__type(Issue)` | `identifier`, `number`, `title`, `description`, `priority` (Float), `estimate` (Float), `dueDate`, `branchName`, `archivedAt`, `trashed`, `createdAt`, `updatedAt`, `team`, `state`, `assignee`, `parent`, `children`, `labels`, `relations`, `inverseRelations`, `cycle`, `project`, `projectMilestone`. |
| `__type(IssueCreateInput)`, `IssueUpdateInput` | `id` (create only, a client-chosen UUID), `title`, `description`, `assigneeId`, `parentId`, `priority` (Int), `estimate` (Int), `labelIds`, `teamId` (required on create), `stateId`, `dueDate`, `cycleId`, `projectId`, `projectMilestoneId`. No branch field. |
| `__type(Mutation)` | `issueCreate(input)`, `issueUpdate(id, input)`, `issueArchive(id, trash)`, `issueUnarchive(id)`, `issueDelete(id)`, `issueRelationCreate(input: { id, type, issueId, relatedIssueId })`, `issueRelationDelete(id)`. |
| `issues(filter: { id: { eq: $id } }, includeArchived: true)` | Matches an identifier, the same identifier in lowercase, and the UUID. A well-formed identifier that does not exist returns an empty list with no error. |
| `issue(id: "<missing identifier>")` | HTTP 200 with `extensions.code: INPUT_ERROR`, `path: ["issue"]`, message "Could not find referenced Issue." The client turns it into `UPSTREAM`. |
| `issues(filter: { id: { eq: "00000000-0000-0000-0000-000000000000" } })` | Fails with "Argument Validation Error", so the id comparator checks the string's shape. |
| Filters with `searchableContent`, `or` of `title`/`description` `containsIgnoreCase`, `assignee.isMe`, `labels.some.name.eq`, `hasBlockedByRelations` | All answer without error on Free. |
| A page of `issues` with the fields in "The issue fragment" and nested connections of 50 | Complexity 466 for pages of 50, 100 and 250 (the workspace has 121 issues), so Linear charges by the nodes it returns. A page of 50 is about 220 KB, mostly descriptions. |
| `issueRelations(first: 100)` | 11 relations, all `related`. No `blocks` relation exists, so no sandbox data shows a blocker. |

Consequences for the design:

- `getIssue` reads through `issues(filter: { id: { eq } })`, not `issue(id)`, so a missing issue is an empty list the adapter turns into `NOT_FOUND` without parsing an error message.
- The adapter checks an id's shape before it sends it, because a malformed id fails as "Argument Validation Error" (`UPSTREAM`) instead of an empty answer.
- `sort` with `createdAt: Ascending` gives pmkit's default order on the server.
- pmkit can choose the UUID of a new issue and of a new relation, so it can check whether an unconfirmed create happened.
- Linear has no field for a branch, a type or acceptance criteria. The design maps them below.

## Goals

- `searchIssues`, `getIssue`, `createIssue`, `updateIssue`, `moveToCategory`, `assign`, `archive`, `link`, `unlink` and `setParent` work on Linear and return the common `Issue` shape, with `{ before, after }` for writes and `{ dryRun: true }` sending no mutation.
- `moveToCategory` sets the state that `mappings.status` names for the category, or the state Linear's type puts there, in the issue's own team.
- Every key of the contract filter becomes part of a Linear `IssueFilter`, or a stated client-side step when Linear has no exact equivalent.
- `me` resolves to the viewer in search and in `assign`. The CLI's actor on Linear is the viewer.
- `operationName` names a document that opens with a fragment, and the fake routes it by that name.
- `issues dependencies` sends an epic id to `getDeliverable` on Linear too.
- The contract suite runs its discovery, issues and relations tests against a stateful fake Linear in `npm test`.

## Non-goals

- Asking for mappings, writing them to `.pmkit/config.yaml`, and the summary approval (PMK-34). "What PMK-34 gets" lists what this issue reads and how it reacts to a gap.
- History and comments (PMK-36). `getHistory`, `listComments` and `comment` stay stubs.
- Cycles (PMK-37). The `sprint` field, the `sprint` filter, and `moveToCycle` stay out.
- Projects as epics, project milestones and documents (PMK-38). A parent that is not an issue, the `milestone` field and `getDeliverable` stay out.
- Releases. Linear releases need the Business plan and no issue maps them yet. The `release` field and filter stay out.
- `delete`. The pmkit contract (`TRACKER_OPERATIONS`) has no delete operation, so this issue adds none. `archive` is the only removal.
- `run_native_query`, `run_saved_view` and `translate_query`. The pmkit design spec leaves natural-language translation to the command, and `TRACKER_OPERATIONS` has no native query operation. Criterion 3 is met by translating the contract filter.
- Triage actions (accept, decline, snooze) and the triage rotation (PMK-43). Moving to `triage` goes through `moveToCategory` only.
- The contract suite against the live sandbox (PMK-39) and the degraded path of each command (PMK-40).
- Creating labels or states in Linear. Domain 17 (Administration) stays out of write reach.

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local tracker output. Every golden stays byte-identical.
- The key in any output, error, cache file or command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.
- A write to Linear from this design work. The live checks in this issue are reads.
- A mutation sent twice. The client sends a mutation once, and the adapter never loops over one.

## Approaches

Two choices shape the work: how a pmkit filter becomes a Linear query, and how a Linear issue becomes a pmkit issue.

### Filter translation

1. **Server only.** Every filter key becomes an `IssueFilter` clause, `sort` goes to Linear's `sort` input, and `limit` becomes `first`. It reads the fewest bytes. It cannot express `blocked: false` (an issue with no open blocker) or pmkit's tie-breaks: pmkit orders equal priorities by newest update and then by id, and puts a missing due date last. Results would differ from the Local tracker for the same data, which the contract suite would catch.
2. **Server filter, client finish.** Every key that Linear expresses exactly becomes an `IssueFilter` clause. The server returns matches oldest first. The adapter then applies the checks Linear cannot express (`blocked`), sorts with the same comparator the Local tracker uses, and cuts to `limit`. When the request needs no client step, `limit` goes to the client's `paginate`, so it stops early.
3. **Client only.** Read every issue of the team and run the Local `runQuery`. Parity is exact, but every search reads the whole team (the sandbox's 121 issues are about 770 KB), the 10-page cap cuts large teams, and criterion 3 asks for a translation to Linear filters.

Chosen: approach 2. It narrows on the server for every key Linear has, and the shared comparator keeps the order identical to the Local tracker.

### Issue model mapping

A. **A pure mapping per direction.** One GraphQL fragment fixes what every read selects. `toIssue(node, context)` builds the pmkit issue, with `context` holding the discovery (state categories per team, labels, the type labels, the estimate scale). Writes go through `toInput(patch, issue, context)`, which builds an `IssueCreateInput` or `IssueUpdateInput`. Fields Linear lacks are mapped to what Linear has: acceptance criteria to a section of the description, the type to the label that `mappings.types` names, the branch to Linear's `branchName`.
B. **A hidden pmkit block in the description.** Type, criteria and branch go into an HTML comment or a YAML block inside the description. Every pmkit field round-trips, but the block shows in Linear's editor, breaks when someone edits the description in Linear, and fights the "work in Linear" habit of the team.
C. **pmkit fields in the user store.** The type and criteria live in `~/.config/pmkit/` keyed by issue. They would differ per teammate and vanish on another machine.

Chosen: approach A. Each field maps to something a Linear user sees and can edit, and the two functions are pure, so the tests cover them without a fake.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/issues.mjs` | New. The issue fragment and documents, `toIssue`, `toInput`, the criteria parser and writer, the priority and estimate maps, `isIssueId`. |
| `scripts/lib/linear/filter.mjs` | New. `translateFilter(filter, context)` returns `{ variables, clientSteps, serverLimit }`. Pure. |
| `scripts/lib/linear/tracker.mjs` | Replaces the stubs of the Issues and Relations operations. Adds `viewer` to `discover()`. Keeps the stubs of every other family. |
| `scripts/lib/linear/client.mjs` | `operationName` names the first operation definition and skips fragments. |
| `scripts/lib/linear/read-mappings.mjs` | New. `readMappings(pmkit)` reads `mappings.status`, `mappings.types` and `mappings.fields.estimate` and returns plain values; `none` counts as unset. It is the only module that reads `mappings`. After PMK-34 merges, it gives way to PMK-34's `resolveMappings` where their shapes match. |
| `scripts/lib/linear/discovery.mjs` | `discoveryView` fills `types` from `mappings.types` and leaves the type labels out of `labels`. |
| `scripts/lib/linear/adapter.mjs` | The Linear descriptor's `settings()` gains `isEpicId(id)` and `trackerBranch: true`. `epicPrefix` stays `null`. The Local descriptor and the test descriptors do not change: the CLI falls back to the `epicPrefix` test when `isEpicId` is absent. |
| `scripts/lib/issue-filter.mjs` | New, shared. `FILTER_KEYS`, `SORTS`, `checkFilter` and the sort comparator move here from `scripts/lib/local/query.mjs`, which imports them. Local behavior stays the same **(builder's call)**. |
| `scripts/pmkit.mjs` | `requireMember` takes the viewer from `discover()` when present. `issues dependencies` uses `isEpicId`. `issues list` warns when the result has `hasMore`. `issues branch` uses the tracker's branch when `trackerBranch` is set. A dry-run create prints `(new)` for an id of `null`. |
| `scripts/contract-suite.mjs` | Each test names the families it needs. `runTrackerContract({ name, setup, families })` skips the tests whose families the adapter does not list. |
| `scripts/fake-linear-api.mjs` | Adds `fakeLinearIssues(options)`, a stateful in-memory issue store that answers pmkit's issue documents. |
| Tests | `scripts/lib/linear/issues.test.mjs`, `filter.test.mjs`, `read-mappings.test.mjs`, `contract.test.mjs`, new cases in `tracker.test.mjs`, `discovery.test.mjs`, `client.test.mjs`, `fake-linear-api.test.mjs`, `cli-linear.test.mjs`, `adapters.test.mjs`. |

This issue does not change `pmkit.config.schema.json` or `scripts/lib/config.mjs`. PMK-34 adds `mappings.types` to the schema and the setup question. Neither validator refuses an unknown key under `mappings` today, so a config with `mappings.types` already loads.

### Ids

A Linear issue's pmkit id is its `identifier` in upper case, such as `ACME-12`. `isIssueId(id)` accepts `^[A-Za-z][A-Za-z0-9_]*-[0-9]+$` and the adapter upper-cases it. Any other string passed as an issue id fails with `NOT_FOUND` before a request, because Linear answers a malformed id with a validation error. UUIDs are not accepted as ids **(builder's call)**: no pmkit output prints them, and one id form keeps `blockedBy` and `parent` comparable.

`isEpicId(id)` for Linear is `!isIssueId(id)`. A descriptor without `isEpicId`, the Local one included, keeps the current test, `epicPrefix !== null && isId(normalizeId(id), epicPrefix)`, inside the command. `issues dependencies` uses it, so on Linear an epic id reaches `getDeliverable`, which throws `NOT_SUPPORTED` until PMK-38 instead of a misleading `NOT_FOUND`.

### The issue fragment

Every read selects one fragment, placed first in its document:

```graphql
fragment PmkitIssueFields on Issue {
  id identifier title description priority estimate dueDate branchName archivedAt trashed createdAt updatedAt
  team { id key } state { id name type } assignee { id } parent { identifier }
  labels(first: 50) { nodes { id name parent { name } } pageInfo { hasNextPage } }
  children(first: 50) { nodes { identifier } pageInfo { hasNextPage } }
  relations(first: 50) { nodes { id type relatedIssue { identifier state { id type } } } pageInfo { hasNextPage } }
  inverseRelations(first: 50) { nodes { id type issue { identifier state { id type } } } pageInfo { hasNextPage } }
}
```

The documents are `PmkitIssues` (search, paged), `PmkitIssueById` (one issue by `id: { eq }`, `includeArchived: true`), `PmkitIssueCreate`, `PmkitIssueUpdate`, `PmkitIssueArchive`, `PmkitRelationCreate`, `PmkitRelationDelete`, `PmkitBlockGraph` and `PmkitParentChain`. Each mutation selects `issue { ...PmkitIssueFields }` where its payload has one.

When a nested connection reports `hasNextPage`, the adapter reads that connection's remaining pages for that issue before it maps it **(builder's call)**. An issue with more than 50 labels or relations is rare, so this costs nothing in the common case and keeps every list complete.

### The issue model

`toIssue(node, context)` returns the common `Issue`:

| pmkit field | From Linear |
|---|---|
| `id` | `identifier` |
| `title` | `title` |
| `status` | `{ name: state.name, category }`. The category comes from `mappings.status` by name, else from `categoryOfType(state.type)`, the rule `discoveryView` already applies. A state missing from the cached discovery triggers one refresh, then falls back to the type. |
| `priority` | `1` urgent, `2` high, `3` medium, `4` low. `0` leaves the field unset. |
| `estimate` | `estimate` as a number on a points team. On a t-shirt team, the size whose value in `estimateScale(...).values` equals it. Unset when `estimate` is null. |
| `assignee` | `assignee.id`, unset when null. |
| `labels` | Label names, sorted, without the labels that `mappings.types` names. |
| `type` | The pmkit type whose label in `mappings.types` the issue has, the first key in map order when several match. Unset when none does. |
| `parent` | `parent.identifier`. A project is not a parent here; PMK-38 decides how a project shows. |
| `blockedBy` | `inverseRelations` of type `blocks`, their `issue.identifier`. |
| `blocks` | `relations` of type `blocks`, their `relatedIssue.identifier`. |
| `related` | `related` relations in both directions, without duplicates. |
| `duplicateOf` | `relations` of type `duplicate`, their `relatedIssue.identifier`. The inverse direction has no pmkit field. `similar` relations are ignored. |
| `children` | `children` identifiers. |
| `archived` | `archivedAt !== null`. Linear archives closed issues on its own after a team-set delay, and those read as archived. |
| `due` | `dueDate` (`YYYY-MM-DD`). |
| `branch` | `branchName`. |
| `description` | `description` without the acceptance criteria section, trimmed. `''` when null. |
| `acceptanceCriteria` | The checklist of that section (below). |
| `created`, `updated` | `createdAt`, `updatedAt` as Linear sends them (ISO 8601 UTC with milliseconds). |
| `sprint`, `milestone`, `release` | Unset. PMK-37 and PMK-38 add the first two. |

Relation lists are sorted with `compareIds` **(builder's call)**, so output does not depend on the order Linear returns.

A trashed issue (`trashed: true`, from `issueDelete` in Linear) reads as `NOT_FOUND` in `getIssue` and is dropped from search results **(builder's call)**. It is in Linear's trash, and the contract has no state for it.

#### Acceptance criteria in the description

Linear has no criteria field. The criteria live in a section of the description that starts with the line `## Acceptance criteria` and ends at the next `## ` heading or the end. Each item is a line `- [ ] text` or `- [x] text`. The parser also accepts `*` bullets and `[X]`, because Linear's editor may rewrite them. Lines in the section that are not checklist items stay in the description, in place, so a read never drops text.

On a write that sets `description` or `acceptanceCriteria`, `toInput` rebuilds the whole description: the description text, a blank line, the heading, a blank line, one `- [ ]` or `- [x]` line per criterion. No criteria means no section. A description that itself contains the line `## Acceptance criteria` is refused with `INVALID_INPUT`, as the Local tracker refuses a `## ` heading. The CLI's `--check` and `--uncheck` work unchanged, because they go through `getIssue` and `updateIssue`.

#### Writes

`toInput(patch, before, context)` builds the Linear input. Every check runs before any mutation, and a dry run runs the same checks.

| Key | Create | Update | Linear input |
|---|---|---|---|
| `title` | required | yes | `title`, trimmed, one line |
| `type` | yes | yes, `null` clears | removes every type label from `labelIds` and adds the label that `mappings.types[type]` names |
| `status` | yes | owned by `issues move` | `stateId` of the name in the target team |
| `priority` | yes | yes, `null` clears | `priority` 1 to 4, `0` to clear |
| `estimate` | yes | yes, `null` clears | `estimate`, checked against the team's scale; a size becomes its value |
| `assignee` | yes | owned by `issues assign` | `assigneeId` of a member |
| `labels` | yes | yes | `labelIds`, plus the type label the issue keeps |
| `parent` | an issue id | owned by `issues parent` | `parentId`, the parent's UUID |
| `due` | yes | yes, `null` clears | `dueDate` |
| `description`, `acceptanceCriteria` | yes | yes | `description`, rebuilt as above |
| `branch` | no | yes | none; see "`issues branch` on Linear" |
| `sprint`, `milestone`, `release` | `null` only | `null` only | none; any other value is `NOT_SUPPORTED` |

The rules:

- Unknown keys and keys another operation owns fail as in the Local tracker, with the same messages and next steps. The key lists move with the shared filter code, or the builder copies them **(builder's call)**.
- The team of a new issue is `tracker.scope.team`. With no team set, the only team of the workspace. With several teams and none set, `NOT_CONFIGURED`, `tracker.scope.team is not set and the workspace has 3 teams`, next step `/pmkit:setup`.
- A label name resolves among the target team's labels first, then the workspace labels. Two labels from one Linear label group are refused with `INVALID_INPUT`, because Linear allows one label per group. An unknown name refreshes the discovery once, then fails with `INVALID_INPUT`, next step `Create the label in Linear, then run pmkit discover`.
- An assignee must be a discovered member; an app user is refused. An unknown id refreshes once, as labels do.
- An estimate on a team with estimates off fails with `INVALID_INPUT` and the hint PMK-33 uses for `estimation`.
- `sprint`, `milestone` and `release` with a value fail with `NOT_SUPPORTED`, naming the Linear field that a later issue maps. `null` is accepted and changes nothing, because the field always reads as unset.

A dry run returns `{ before, after }` where `after` is `before` with the patch applied by the same mapping code, and sends no mutation. A dry-run create returns `after.id: null`, because Linear picks the number.

### Actor and `me`

ADR-0005 decides the actor. On Linear the actor is the viewer, the owner of `LINEAR_API_KEY`.

- `discover()` adds `viewer: { id, name }` from `client.session()`, on a cached read as well as a fresh one. It costs the session request, which every other Linear operation sends anyway.
- `requireMember` in `scripts/pmkit.mjs` returns the viewer when `discover()` has a `viewer` key, before it looks at the git email and `PMKIT_USER`. The Local tracker's `discover()` has no such key, so Local behavior is unchanged. `whoami` on Linear prints the viewer.
- Every Linear write checks that `actor` is the viewer's id. Any other value, including a member passed with `--as`, fails with `INVALID_INPUT`, `Linear records every write as the owner of LINEAR_API_KEY (<viewer name>)`, next step `Drop --as, or use a key created by that member`. That also gives the contract suite's `not-a-member` case its `INVALID_INPUT`.
- `assign(id, 'me', actor)` assigns the actor, as the Local tracker does.
- `searchIssues({ assignee: 'me' })` filters on the viewer's id.

### `moveToCategory` (criterion 2)

`moveToCategory(id, category, actor, { status, dryRun })`:

1. Check `category` against `CATEGORIES`, then read the issue (`before`). Its team decides the states.
2. With `status`, the name must be a state of that team whose category is `category`. Otherwise `INVALID_INPUT` lists the team's states in the category.
3. Without `status`, the target is:
   - the state that `mappings.status[category]` names, when the key is set;
   - else the first state by `position` whose category is `category`. For `canceled`, a state of type `canceled` comes before one of type `duplicate`. A state that another `mappings.status` key names already has that key's category, so it is not a candidate. `mappings.status.blocked` has no effect here.
4. When the issue already has that state, the result is `{ before, after: before }` and no mutation is sent.
5. Otherwise `issueUpdate(id, { stateId })`, and `after` is the mapped payload issue.

On the sandbox description this picks `In Progress` for `in_progress`, `Done` for `done` and `Canceled` for `canceled`, and `In Review` for `in_review` only once `mappings.status.in_review` names it.

When step 3 finds nothing:

| Case | Error |
|---|---|
| `mappings.status[category]` names a state the issue's team lacks, after one discovery refresh | `NOT_CONFIGURED`, `mappings.status.in_review names In Review, which team ACME does not have`, next step `/pmkit:setup` |
| `in_review` with no mapping | `NOT_CONFIGURED`, `team ACME has no state mapped to in_review`, next step `/pmkit:setup` |
| `mappings.status[category]` is `none` | `NOT_SUPPORTED`, `team ACME has no status in the in_review category`, next step `/pmkit:setup` |
| `triage` on a team with triage off | `NOT_SUPPORTED`, with the `native_triage` hint `Turn on triage in the team's settings in Linear` |
| any other category with no state | `INVALID_INPUT`, `team ACME has no state in category <category>` |

### `assign` and `archive`

`assign(id, who, actor)` takes a member id, `'me'` or `null`. It sends `issueUpdate(id, { assigneeId })`, with `null` to unassign, and skips the mutation when nothing changes. `archive(id, actor)` sends `issueArchive(id)` without `trash`, skips it for an issue already archived, and returns `after` from a read of the issue with `includeArchived: true`, because the archive payload carries no issue fields **(builder's call)**.

### Relations (criterion 1)

`link(from, to, kind, actor)` and `unlink(from, to, kind, actor)` take `kind` from `LINK_KINDS`. An unknown kind and a self link fail with `INVALID_INPUT`, as in the Local tracker.

| pmkit | Linear |
|---|---|
| `link(a, b, 'blocks')` | `issueRelationCreate({ type: blocks, issueId: a, relatedIssueId: b })` |
| `link(a, b, 'related')` | `issueRelationCreate({ type: related, issueId: a, relatedIssueId: b })` |
| `link(a, b, 'duplicate')` | `issueRelationCreate({ type: duplicate, issueId: a, relatedIssueId: b })`, so `a.duplicateOf` holds `b` |
| `unlink(a, b, kind)` | `issueRelationDelete(id)` for each relation of that type from `a` to `b`; for `related`, in either direction |

- Both issues are read first. A link that already exists, or an unlink with nothing to remove, sends no mutation and returns `{ before, after: before }`.
- A `blocks` link that would close a loop fails with `INVALID_INPUT` and the loop as `A → B → A`, as in the Local tracker. `PmkitBlockGraph` reads one level of blocked issues per request, with `id: { in: frontier }`, from `b` toward `a`, for at most 10 levels **(builder's call)**. A deeper chain is not checked, and the spec's risks say so.
- The result is `{ before, after }` of `a`, the issue the CLI names first, read again after the mutation because the relation payload has no issue fields.
- `unlink` of a missing issue fails with `NOT_FOUND`. The Local tracker can remove a reference to a missing issue because the reference lives in a file; a Linear relation to a deleted issue no longer exists.

`setParent(id, parent, actor)`:

- `parent` is an issue id or `null`. Any other value fails with `NOT_SUPPORTED`, `Linear projects are not epics in pmkit yet` (PMK-38).
- A self parent fails with `INVALID_INPUT`. A loop fails with `INVALID_INPUT` and the chain: `PmkitParentChain` reads the new parent's ancestors in one query nested 10 levels deep **(builder's call)**.
- It sends `issueUpdate(id, { parentId })`, with `null` to clear, and skips it when nothing changes.

### Unconfirmed creates

When `issueCreate` or `issueRelationCreate` fails with the client's `UPSTREAM` "Linear did not confirm the change", the adapter reads the UUID it sent, once, with a query. If the record exists, the write succeeded and the operation returns it. If not, the original error propagates, with its next step to check Linear before retrying. Updates, archives and deletes of relations are idempotent, so they keep the client's behavior. The client still sends each mutation once.

### Search (criterion 3)

`searchIssues(filter)` checks the filter with the shared `checkFilter`, where `types` is `discover().types` and `members` are the discovered member ids, then calls `translateFilter`.

#### The translation table

| pmkit key | Linear `IssueFilter` or argument | Client step |
|---|---|---|
| (scope) | `team: { key: { eq: <tracker.scope.team> } }` when a team is set; else the whole workspace | |
| `text` | `or: [{ title: { containsIgnoreCase } }, { description: { containsIgnoreCase } }]` | |
| `categories` | `state: { id: { in: <ids> } }`, the ids of every discovered state whose category is listed, in the scoped teams | An empty id list returns `[]` with no request |
| `types` | `labels: { some: { name: { in: <the labels mappings.types names for those types> } } }` | |
| `assignee` | an id or `me`: `assignee: { id: { eq } }`, with the viewer's id for `me`; `none`: `assignee: { null: true }` | |
| `labels` | one `labels: { some: { name: { eq } } }` per label, inside `and` | |
| `parent` | an issue id: `parent: { id: { eq: <identifier> } }`. Any other value: `NOT_SUPPORTED` (PMK-38) | |
| `blocked: true` | `hasBlockedByRelations: { eq: true }` | Keep issues with a `blocks` inverse relation whose issue's category is not terminal |
| `blocked: false` | none | Drop the issues that the same check calls blocked |
| `updatedBefore`, `updatedAfter` | `updatedAt: { lt }`, `updatedAt: { gt }` | |
| `archived: true` | `includeArchived: true` argument | |
| `sort` | `sort: [{ createdAt: { order: Ascending } }]` always | The shared comparator for the requested sort |
| `limit` | `limit` of `paginate` when no client step applies and the sort is `created` | Otherwise cut after sorting |
| `sprint`, `release` | none | `NOT_SUPPORTED` (PMK-37, no issue for releases) |

All clauses join with `and`. `translateFilter` returns `{ variables, clientSteps, serverLimit }` and makes no request, so `filter.test.mjs` checks every row with plain data.

The blocked check reads the blocker's state from the relation node and maps it through the same category rule, so a blocker in another team counts correctly. A blocker that Linear no longer returns counts as blocking, as `isBlocked` does.

`text` uses `containsIgnoreCase` on title and description instead of `searchableContent` **(builder's call)**. Its meaning matches the Local substring search; `searchableContent` has no documented scope and may include comments.

#### Paging and the cap

`PmkitIssues` pages with the client's `paginate` at 100 nodes per page **(builder's call)**. Without a server limit, the client stops after 10 pages, 1000 issues. The result is `{ issues, problems: [], hasMore }`. `hasMore` is `true` when the cap cut the read, and `issues list` then warns `Linear has more matching issues than the 1000 pmkit read; narrow the filter`. With a client-side sort and a cut, the order covers the issues read, and the warning says so.

### What this issue reads from `mappings`

| Key | Use | When missing |
|---|---|---|
| `mappings.status.<category>` | The category of a state on every read (already in `discoveryView`), the target of `moveToCategory`, and the state ids of the `categories` filter | Reads and filters use the state type. A move to `in_review` fails with `NOT_CONFIGURED`. A move to another category picks the first state by position. |
| `mappings.status.<category>` naming a state the team lacks | | `discover` warns (PMK-33). A move to that category fails with `NOT_CONFIGURED` after one refresh. Reads and filters use the state type. |
| `mappings.status.blocked` | None. It changes no category, no move target and no `blocked` filter in this issue. | Nothing changes. |
| `mappings.fields.estimate` | `native`: Linear's estimate field | Absent, any other value, `none` or a label group: `estimate` reads as unset and estimate writes fail with `NOT_SUPPORTED`. Size label groups are a follow-up issue. |
| `mappings.types` | A map from a pmkit type name to one Linear label name, such as `{ bug: Bug, feature: Feature }`. A pmkit type with no label is not a key. `discover().types` lists every key, in map order. | Absent: `discover().types` is `[]`, `type` reads as unset, and a `type` write or filter fails with `INVALID_INPUT`, next step `/pmkit:setup`. A key whose label is missing: `discover` warns `mappings.types.bug names Bug, which team ACME does not have`, and the type stays in `discover().types`. A value that is not such a map: `discover` warns and the adapter reads it as absent. |

The adapter reads no other key of `mappings.fields`. Priority, assignee and due date are Linear's own fields, and acceptance criteria always live in the `## Acceptance criteria` section. A value of `none`, which PMK-34 reserves for "the team has no such thing", counts as unset in every key.

`readMappings(pmkit)` in `scripts/lib/linear/read-mappings.mjs` is the one reader of these keys. It returns `{ status: { <category>: name }, statusNone: [<category>], blockedStatus, types: { <type>: labelName }, typeOf, estimate: 'native' | null, problems: [] }`. PMK-34's `resolveMappings` is not merged yet and this issue imports nothing from its branch. When PMK-34 merges, `readMappings` switches to `resolveMappings` if their names and shapes differ, and the tests of this issue keep passing as the check.

### What PMK-34 gets

- The `NOT_CONFIGURED` errors above, all with next step `/pmkit:setup`, as the points where "the command stops and asks". PMK-34 makes setup ask again for the key the error names.
- `mappings.types` in the schema and the setup question. PMK-34 owns both. The shape is a map from a pmkit type name to one Linear label name. A good default to offer is the labels of a group named `Type`, or the flat labels `Bug` and `Feature` that the sandbox has.
- An absent `mappings.fields.estimate` reads as no estimate, which matches PMK-34's rule 4. The switch to `resolveMappings` confirms the two agree.
- `mappings.status.blocked` with no effect in this issue. PMK-34's rule 3 and a follow-up issue decide when it makes an issue blocked.
- A rule for `mappings.status.in_progress`: setup can leave it unset when the first `started` state by position is the one the team means.

PMK-34 should not ask for `mappings.fields.acceptance_criteria`, `priority`, `assignee` or `target_date` on Linear, because this adapter ignores them.

### Contract suite against the fake

`runTrackerContract({ name, setup, families })` gains `families`, a list such as `['discovery', 'issues', 'relations']`. Each test declares the families it uses. A test whose families are not all listed registers as skipped, with the missing family as the reason. Without `families`, every test runs, so the three Local runs in `scripts/contract.test.mjs` stay as they are.

| Test | Families |
|---|---|
| implements every contract operation; discover lists statuses, members, types | `discovery` |
| creates, gets, updates, moves, assigns and archives; rejects unknown issues and bad writes; archived issues drop out of search | `issues` |
| link blocks and unlink; related and duplicate | `relations` |
| comments and history; log time | `history`, `time` |
| cycles, sprint current, capacity, days off | `cycles` |
| epics, status updates | `deliverables`, `relations` |
| milestones, releases, documents | `milestones`, `releases`, `documents` |
| every dry run changes nothing | every family |

`scripts/lib/linear/contract.test.mjs` runs the suite with `families: ['discovery', 'issues', 'relations']`. Its `setup()` returns a Linear tracker over `fakeLinearFetch({ ...fakeWorkspace(sandboxLike), ...fakeLinearIssues().routes })`, a fresh `PMKIT_HOME` from `userStoreEnv()`, `env.LINEAR_API_KEY = FAKE_KEY`, and `actor: 'user-1'`, the fake viewer. The workspace description adds a `Triage` state with triage on, `mappings.status.in_review: In Review` and `mappings.types: { bug: Bug, feature: Feature }`, so every category and at least one type exist.

`fakeLinearIssues()` keeps issues and relations in memory and answers the documents listed in "The issue fragment" by operation name. It evaluates the filter clauses that `translateFilter` emits and the `sort` input, pages by `first` and `after`, assigns identifiers `ACME-1`, `ACME-2` and so on, and honors a client-chosen `id`. It answers an unknown filter key with a `GRAPHQL_VALIDATION_FAILED` error, so a translator that emits a clause the fake does not know fails the test instead of matching everything. It records each mutation, so tests can assert that a dry run sent none.

The dry-run test of the suite needs every family, so on Linear it is skipped. `tracker.test.mjs` replaces it with a stronger check for these operations: each write with `{ dryRun: true }` sends no mutation, and returns the same `after` as the real write that follows.

The fake's semantics come from the facts above, not from Linear. PMK-39 runs the same suite against the sandbox and finds where they differ.

### `operationName`

`operationName(document)` uses the lexer behind `definitionKeywords` to find the first definition whose keyword is `query`, `mutation` or `subscription`, and returns the name that follows it, or `null` when that operation is anonymous or the document cannot be read. A test covers `fragment F on Issue { id } mutation PmkitIssueUpdate(...) { ... }`, which today returns `null`, and `fakeLinearFetch` then routes it to `PmkitIssueUpdate`. `paginate`'s broken-page error names the operation too.

### `issues branch` on Linear

Linear has no field for a branch and suggests one in `branchName`, and the Linear tab's "Work on issue" flow creates the branch "with the name Linear suggests, which triggers the automatic GitHub or GitLab link". The user chose Linear's `branchName`:

- `updateIssue(id, { branch })` on Linear succeeds with no mutation when `branch` equals `branchName`, and fails with `INVALID_INPUT`, `Linear names this issue's branch <branchName>`, otherwise.
- The Linear descriptor's `settings()` returns `trackerBranch: true`. `issues branch` then names the branch `issue.branch` instead of `branchName(issue.id, issue.title)`. The Local descriptor returns `false`, so Local output stays the same.

## Testing

No test opens a socket. Every tracker test injects `fakeLinearFetch` and sets `PMKIT_HOME` with `userStoreEnv()`.

- `issues.test.mjs`: each row of the issue model table, both relation directions, `similar` ignored, a t-shirt estimate both ways, type labels split out of `labels`, criteria parsed with `-`, `*`, `[x]` and `[X]`, non-checklist lines kept, the description rebuilt and parsed back unchanged, a description holding the heading refused, a trashed node dropped, `isIssueId` on good and bad shapes.
- `filter.test.mjs`: every row of the translation table, `and` of several keys, an empty `categories` id list giving no request, `me` with the viewer id, `blocked` true and false as client steps, `serverLimit` set only for `created` without client steps, `sprint` and `release` refused.
- `tracker.test.mjs`: each operation against `fakeLinearIssues`; every `moveToCategory` row, including each error case; label, member and state misses refresh once; `--as` another member refused; a write without a workspace gives `NOT_CONFIGURED`; a dry run sends no mutation; an unconfirmed create that exists returns it, and one that does not rethrows; a blocks loop and a parent loop refused; no file in the store holds `FAKE_KEY`.
- `contract.test.mjs` under `scripts/lib/linear/`: the suite with the three families.
- `client.test.mjs`: `operationName` with a fragment first, with comments, and with an anonymous query after a fragment. `fake-linear-api.test.mjs`: a named mutation after a fragment routes by its name.
- `cli-linear.test.mjs`: `issues list --assignee me --json` sends the viewer's id; `issues assign ACME-1 me` assigns the viewer; `whoami` prints the viewer; `issues dependencies <non-issue id>` fails with `NOT_SUPPORTED` from `getDeliverable`, not `NOT_FOUND`; `issues list` prints the `hasMore` warning; `issues branch` uses Linear's name.
- `read-mappings.test.mjs`: `mappings.types` read as a map in key order, a value that is not a map read as absent with a problem, `none` read as unset, an absent estimate read as no estimate.
- `discovery.test.mjs`: `types` from `mappings.types`, a missing label warned and kept, the type labels left out of `labels`.
- `adapters.test.mjs`: the Linear `settings()` with `isEpicId` and `trackerBranch`, the Local `settings()` unchanged.
- Every golden stays byte-identical, and the Local contract runs still run every test.
- An opt-in live case joins `scripts/lib/linear/client-live.mjs` behind `PMKIT_LIVE=1`. It runs `searchIssues` once per translation row against the sandbox, read-only, and checks that Linear accepts each filter. Writes stay for PMK-39.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. The adapter implements the Issues and Relations operations of the contract | "Ids", "The issue fragment", "The issue model" (reads and writes), "Actor and `me`", "`assign` and `archive`", "Relations", "Unconfirmed creates", "Search"; the contract suite's `issues` and `relations` families against `fakeLinearIssues`; the `tracker.test.mjs` and `cli-linear.test.mjs` cases. `delete` is outside the pmkit contract, as "Non-goals" says. |
| 2. `move_to_category` sets the workflow state mapped to the category | "`moveToCategory`" (the mapped state, the default by position, the error table), "What this issue reads from `mappings`", and the contract test that moves an issue through all seven categories |
| 3. Issue filters translate to Linear filters | "Search": the translation table, the client steps, paging and the cap; `filter.test.mjs`; the opt-in live read per row |

## Decisions

| Decision | Reason |
|---|---|
| Server filter, client finish | Exact for every key Linear has, the same order as the Local tracker, and early stop when no client step applies. |
| A pure mapping per direction, criteria in a description section | Every field stays visible and editable in Linear, and the mapping is testable without a fake. |
| `getIssue` through `issues(filter: { id })` | A missing issue is an empty list, so `NOT_FOUND` does not depend on Linear's error message. |
| Identifiers only as ids, shape checked first | Linear fails a malformed id with a validation error; one id form keeps relation lists comparable. |
| The actor is the viewer, `--as` refused | ADR-0005: Linear records every write as the key's owner, so another actor would make pmkit's output disagree with Linear. |
| `discover()` carries `viewer` | `requireMember` needs it on every run, and the session request goes out anyway. |
| `isEpicId` in `settings()` | The command asks the adapter what an id is, so PMK-38 only fills in `getDeliverable`. |
| Client-chosen UUIDs on creates | An unconfirmed create can be checked with a query instead of leaving a possible duplicate. |
| A family list in the contract suite | One suite for every adapter (ADR-0001), run in parts while the Linear adapter grows. |
| A stateful fake that refuses unknown filter keys | The suite needs state across calls, and a translator bug must fail, not match everything. |
| Page size 100, cap 1000 | A page of 100 cost 466 complexity on the sandbox; the cap is the client's 10 pages. |
| `NOT_CONFIGURED` for a missing mapping, `NOT_SUPPORTED` for a team setting | Q6: a broken mapping sends the user to setup. A team setting is Linear's, and the hint names it. |

## Risks

- **Mutations are unverified.** No write ran in this issue. The input fields come from introspection. PMK-39 must confirm that `issueCreate` with a client `id` works, that `issueArchive` keeps the issue readable with `includeArchived`, and that `estimate` takes the size values on a t-shirt team.
- **A duplicate link may close the issue.** In Linear's UI, marking an issue as a duplicate moves it to a `duplicate` state. If the API does the same, `link(a, b, 'duplicate')` also changes `a`'s status, and the returned `after` shows it. Linear may also refuse a second relation between the same pair, which the contract test "links related and duplicate" does.
- **Markdown round trip.** Linear's editor may rewrite the description, such as bullets or escapes. The criteria parser is tolerant, but PMK-39 should check one write and read.
- **The parent filter by identifier is not verified.** The sandbox has no sub-issues. If `parent: { id: { eq: <identifier> } }` does not match, the adapter resolves the parent's UUID first, at one more request.
- **Blocker chains in `issues dependencies`.** The command builds its map from `searchIssues({ archived: true })` of the scoped team. A blocker in another team, or past the 1000-issue cap, is missing from the map and counts as blocking. The `hasMore` warning shows the cap.
- **Old closed issues read as archived.** Linear's auto-archive makes them drop out of a default search, so a count of done issues without `--archived` is lower than in Linear's own view.
- **Loop checks have a depth limit.** A `blocks` loop longer than 10 levels goes through unchecked.
- **Identifiers change when an issue moves teams.** Linear keeps the old identifier resolvable in the UI. Whether the `id` filter matches it is unknown, so an old id in a commit message may read as `NOT_FOUND`.
- **Free plan issue limit.** A Free workspace holds a limited number of active issues. The sandbox has 121. PMK-39's live writes should archive what they create.
- **The fake can drift from Linear.** The suite against the fake proves the adapter matches the fake. The opt-in live read checks the filters, and PMK-39 checks the rest.
- **Shared filter module.** Moving `checkFilter` and the comparator touches Local code. The Local suite and the goldens must stay unchanged, and the plan should keep the move a separate commit.

## Resolved questions

The user answered on 2026-10-27.

1. **How does a Linear issue get a pmkit type?** One key, `mappings.types`, a map from a pmkit type name to one Linear label name, such as `{ bug: Bug, feature: Feature }`. A pmkit type with no label is left out of the map. PMK-34 owns the schema change and the setup question; this issue only reads the key, through `readMappings` until PMK-34's `resolveMappings` is merged.
2. **Does PMK-35 read estimates from a label group?** No. PMK-35 reads Linear's native estimate field only. Size label groups are a follow-up issue.
3. **What happens to `branch` on Linear?** `branch` reads as Linear's `branchName`. An update with that name is a no-op, any other name is refused, and `issues branch` uses Linear's name through `settings().trackerBranch`.
4. **Does `mappings.status.blocked` make an issue blocked?** Not in this issue. A status mapped as `blocked` has no effect: no category, no move target, no filter.

## Left to the builder

- The split between `issues.mjs`, `filter.mjs` and `tracker.mjs`, and the names of the GraphQL documents, as long as each document has a name and the fake routes by it.
- Wording of messages and next steps beyond the templates above, as long as none names a secret or the real workspace.
- The shape of `fakeLinearIssues()` options.
- Whether the shared filter code moves to `scripts/lib/issue-filter.mjs` or the Linear adapter imports it from `scripts/lib/local/query.mjs`.

## Self-review

- Placeholders: none. Facts not verified live are in "Risks" with the check that settles them.
- Consistency: "viewer" is the owner of `LINEAR_API_KEY` everywhere. "Client step" means work the adapter does after Linear answers. Examples use `acme` and `ACME`.
- Scope: three new adapter modules, one shared module, the tracker's issue and relation operations, a client fix, a suite option, a fake, a `types` change in the discovery view and five small CLI changes. No schema change, no write to Linear, no new ADR.
- Boundaries: mappings questions go to PMK-34, history and comments to PMK-36, cycles to PMK-37, projects and milestones to PMK-38, the live suite to PMK-39, degraded paths to PMK-40, triage rotation to PMK-43, and "Non-goals" says so.
