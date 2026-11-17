# PMK-87 design: issues, sub-issues and dependencies for GitHub Issues

Issue PMK-87, epic EPC-8 (GitHub Issues tracker adapter), milestone `github-issues`. Status: approved by the user on 2026-11-16, with the nine builder's calls. The user answered six questions on 2026-11-16, and "Decisions from the user" records the answers. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The GitHub tracker answers `discover` and `capabilities` (PMK-86) and throws `NOT_SUPPORTED` for every other contract operation (`scripts/lib/github/tracker.mjs`). No command can list, read, create, move or link a GitHub issue, read its history or comment on it.

Acceptance criteria:

1. The adapter implements the Issues, Relations, History, Comments and Native search operations.
2. `move_to_category` sets the Status option and opens or closes the issue.

Source: Unified model, "Common status categories" ("project field plus open or closed (GitHub)"), and the contract families of the pmkit design spec.

## Decisions already made

ADR 0007 and the PMK-84, PMK-85 and PMK-86 specs settle these, and this spec does not reopen them:

- Every call goes through `createGithubClient` (`scripts/lib/github/client.mjs`) with `tracker.scope.host`. pmkit holds no token.
- The config holds `tracker.scope.host`, `tracker.scope.repo` (`owner/name`) and `tracker.scope.project` (`owner/number` or `none`).
- Status: `mappings.status.<category>: <option name>|none`. Reading rule: a closed issue is `done`, or `canceled` when GitHub's state reason is not planned or duplicate, whatever its option. An open issue takes its option's category. An open issue with no option is `todo`. An option no category names counts as `in_progress`, with a warning. `move_to_category` sets the Status option and opens or closes the issue: close reason completed for `done`, not planned for `canceled`.
- Fields: `mappings.fields.<role>: issue:<name>|project:<name>|none`. Types: `mappings.types.<pmkit type>: <issue type name>`, GitHub's native issue types.
- The minimum GHES version is 3.19. Sub-issues, issue types and `blockedBy` dependencies need no version branch. Issue fields exist only on github.com, GHE.com and GHES 3.21 and later.
- With `tracker.scope.project: none`, statuses come from open and closed only. The rest of the degrade without a Project, and labels as a type fallback, belong to PMK-89.
- PMK-86 left three things to this issue: assignable users as `members`, the discovery cache, and the mapping check before each operation.

## Decisions from the user

1. **Issue ids.** An issue of `tracker.scope.repo` is its number alone, such as `12`. An issue of another repository is `owner/name#number`, such as `acme/other#5`; pmkit reads and links it but never creates one there. Input also takes `#12` and `acme/widgets#12` and normalizes them, so `acme/widgets#12` becomes `12` when `acme/widgets` is the scope repository. `branchName('12', title)` gives `12-<slug>`, which is the name `gh issue develop` uses.
2. **Archive.** `archive` archives the issue's item in the configured Project (`archiveProjectV2Item`). An issue reads `archived: true` when that item is archived, and search leaves it out unless the filter has `archived: true`. With `tracker.scope.project: none`, `archive` answers `NOT_SUPPORTED`. `unarchive` answers `NOT_SUPPORTED`, as on Linear (PMK-250). `delete` runs `deleteIssue`. GitHub has no trash, so `restore` answers `NOT_SUPPORTED`.
3. **Related and duplicate.** `duplicate` maps to `closeIssue(stateReason: DUPLICATE, duplicateIssueId)` and its unlink to `unmarkIssueAsDuplicate`. GitHub closes the duplicate, so it then reads as `canceled`, and the result carries a note that says so. `related` uses `addRelatesTo` and `removeRelatesTo` on github.com and GHE.com, and answers `NOT_SUPPORTED` on GHES, which has no related issues in any published schema.
4. **Comment threads.** GitHub issue comments are flat. `comment` with `replyTo` and `resolveThread` answer `NOT_SUPPORTED`, `GitHub issue comments have no threads`. The contract suite splits a `threads` family out of `history`. Local and Linear list it; GitHub leaves it out, so it still runs the comment and history tests.
5. **Search.** `searchIssues` reads `repository.issues` for every search: `filterBy` narrows by state, assignee, type and update date on the server, and a client step applies the rest. The page cap and `hasMore` work as on Linear.
6. **Branch.** `updateIssue(id, { branch })` runs `createLinkedBranch` at the head commit, on GitHub, of the branch the new branch starts from (see the note below), and `issue.branch` reads the first linked branch. The branch then exists on GitHub before the first push. When the local base lacks that commit, the push of `pr open` is refused as non-fast-forward, so `issues branch` on a GitHub tracker says so in a note and names the fix. A test covers the note.

## Facts checked against GitHub

Checked on 2026-11-16 with gh 2.93.0: schema introspection on github.com, and the GHES schemas GitHub publishes in `github/docs` (`src/graphql/data/ghes-3.19` to `ghes-3.22`, and `fpt`). No write was sent.

| Check | Result |
|---|---|
| `Issue` on GHES 3.19 | `number`, `title`, `body`, `state`, `stateReason`, `createdAt`, `updatedAt`, `author`, `assignees`, `labels`, `issueType`, `parent`, `subIssues`, `blockedBy`, `blocking`, `duplicateOf`, `linkedBranches`, `projectItems(includeArchived)`, `comments`, `timelineItems(itemTypes, since)`. |
| `Issue.relatesTo`, `addRelatesTo`, `removeRelatesTo` | In the `fpt` schema (github.com) and on github.com's live schema. In no GHES schema from 3.19 to 3.22. |
| `Issue.issueFieldValues`, `setIssueFieldValue` | GHES 3.21 and later, github.com. Not in 3.19 or 3.20. Values: `IssueFieldSingleSelectValue { optionId name }`, `IssueFieldNumberValue { value }`, `IssueFieldDateValue { value }`. |
| `CreateIssueInput` on 3.19 | `repositoryId`, `title`, `body`, `assigneeIds`, `labelIds`, `issueTypeId`, `parentIssueId`. `projectV2Ids` arrives only in 3.21, so a new issue joins the Project through `addProjectV2ItemById` on every host. |
| `UpdateIssueInput` on 3.19 | `id`, `title`, `body`, `assigneeIds`, `labelIds`, `state`, `issueTypeId`. |
| `closeIssue`, `reopenIssue` | `CloseIssueInput { issueId, stateReason, duplicateIssueId }`. `IssueStateReason`: `COMPLETED`, `NOT_PLANNED`, `DUPLICATE`, `REOPENED`. |
| Dependencies and sub-issues | `addBlockedBy { issueId, blockingIssueId }`, `removeBlockedBy`, `addSubIssue { issueId, subIssueId, replaceParent }`, `removeSubIssue`, all on 3.19. |
| Project items | `addProjectV2ItemById`, `updateProjectV2ItemFieldValue` (`singleSelectOptionId`, `number`, `date`), `clearProjectV2ItemFieldValue`, `archiveProjectV2Item`, `unarchiveProjectV2Item`, `ProjectV2Item.isArchived`, `fieldValueByName(name)`, all on 3.19. |
| `IssueFilters` on 3.19 | `assignee`, `createdBy`, `labels` (matches any of them), `mentioned`, `milestone`, `since` (updated since), `states`, `type`. `IssueOrderField`: `CREATED_AT`, `UPDATED_AT`, `COMMENTS`. |
| Timeline item types on 3.19 | `ISSUE_COMMENT`, `RENAMED_TITLE_EVENT`, `ASSIGNED_EVENT`, `UNASSIGNED_EVENT`, `LABELED_EVENT`, `UNLABELED_EVENT`, `CLOSED_EVENT`, `REOPENED_EVENT`, `ISSUE_TYPE_ADDED_EVENT`, `ISSUE_TYPE_CHANGED_EVENT`, `ISSUE_TYPE_REMOVED_EVENT`, `BLOCKED_BY_ADDED_EVENT`, `BLOCKED_BY_REMOVED_EVENT`, `BLOCKING_ADDED_EVENT`, `BLOCKING_REMOVED_EVENT`, `PARENT_ISSUE_ADDED_EVENT`, `PARENT_ISSUE_REMOVED_EVENT`, `SUB_ISSUE_ADDED_EVENT`, `SUB_ISSUE_REMOVED_EVENT`, `MARKED_AS_DUPLICATE_EVENT`, `UNMARKED_AS_DUPLICATE_EVENT`. `ProjectV2ItemStatusChangedEvent` arrives in 3.21. |
| Comments | `IssueComment { id author body createdAt isMinimized minimizedReason }`. No parent and no replies on any host. `addComment { subjectId, body }`. |
| Members | `Repository.assignableUsers` on 3.19. |
| Branches | `createLinkedBranch { issueId, oid, name, repositoryId }` creates the branch on GitHub at `oid`. `LinkedBranch { ref { name } }`. `Repository.ref(qualifiedName) { name target { oid } }`. |

## Goals

- Every operation of the Issues, Relations, History and Comments families works on GitHub and returns the common shapes, with `{ before, after }` for writes and `{ dryRun: true }` sending no mutation.
- `moveToCategory` sets the Status option and opens or closes the issue.
- `searchIssues` translates the contract filter to `repository.issues` filters and finishes on the client.
- `discover` returns the assignable users as `members`, reads through a cache in the user store, and every operation but `discover` and `capabilities` stops on a broken mapping first.
- The contract suite runs its discovery, issues, relations and history tests against a stateful fake GitHub in `npm test`.
- A runbook for the issue flows on GitHub, with an E2E test on a fake `gh`.

## Non-goals

- Iterations, milestones, Project status updates and epics (PMK-88). `sprint`, `milestone` and `release` writes with a value answer `NOT_SUPPORTED`; `getDeliverable` stays a stub.
- Labels as a type fallback and the full degrade without a Project (PMK-89).
- `run_native_query` and `translate_query`. `TRACKER_OPERATIONS` has no native query operation, so the Native search criterion is met by translating the contract filter to GitHub's native issue filter, as PMK-35 did for Linear.
- Delegation to an agent and time tracking. `delegate`, `logTime` and `listTimeEntries` answer `NOT_SUPPORTED` with the manifest's hint.
- Pull requests in the tracker. `repository.issues` returns issues only.
- A live run of the contract suite against github.com: a follow-up candidate.

## Anti-goals

- `npm test` starting a real `gh` or opening a socket.
- A token in any output, error, cache file or argument (ADR 0007).
- A hidden pmkit block in an issue body. Every value maps to something a GitHub user sees and can edit.
- A mutation sent twice. The client sends each mutation once.
- A change to any Local or Linear output. Every golden stays byte-identical.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/github/ids.mjs` | New. `parseIssueId`, `isIssueId`, `issueIdOf(node, repo)`. |
| `scripts/lib/github/documents.mjs` | New. The issue fragment and every query and mutation, built per host (issue fields and status events only where the schema has them). |
| `scripts/lib/github/issues.mjs` | New. `toIssue(node, context)`, the status rule, the field readers, `makeContext`. Pure. |
| `scripts/lib/github/writes.mjs` | New. Checks a create or update patch and plans its mutations. Pure. |
| `scripts/lib/github/filter.mjs` | New. `translateFilter(filter, context)` returns `{ variables, clientSteps }`. Pure. |
| `scripts/lib/github/issue-ops.mjs` | New. `searchIssues`, `getIssue`, `createIssue`, `updateIssue`, `moveToCategory`, `assign`, `archive`, `delete`. |
| `scripts/lib/github/relation-ops.mjs` | New. `link`, `unlink`, `setParent`. |
| `scripts/lib/github/history.mjs` | New. `toEvents(node, context)`, `toComment(node, id)`. Pure. |
| `scripts/lib/github/history-ops.mjs` | New. `getHistory`, `listComments`, `comment`, `resolveThread`, `metricEvents`. |
| `scripts/lib/github/manifest.mjs` | New. `buildGithubCapabilities(raw, pmkit)`. |
| `scripts/lib/github/discovery.mjs` | The repository query adds the repository id, label ids, the viewer id and the assignable users. `discoveryView` returns them as `members`. |
| `scripts/lib/github/tracker.mjs` | The discovery cache and memo, the mapping check, the guarded operations, the manifest. |
| `scripts/lib/github/adapter.mjs` | `settings()` gains `isEpicId` and `trackerBranch: true`, and `remoteBranch: true` for the note of `issues branch`. |
| `scripts/lib/body-criteria.mjs` | New, shared. `parseDescription` and `buildDescription` move here from `scripts/lib/linear/issues.mjs`, which re-exports them, so Linear behavior stays the same **(builder's call)**. |
| `scripts/pmkit.mjs` | `issues branch` adds the linked-branch note when `settings().remoteBranch` is true. |
| `scripts/contract-suite.mjs` | The thread test needs `['history', 'threads']`. `FAMILIES` gains `threads`. |
| `scripts/lib/linear/contract.test.mjs` | Lists `threads`. |
| `scripts/fake-github-issues.mjs` | New. A stateful fake of the GitHub API for pmkit's documents. Its state is plain JSON, so the E2E wrapper saves it between CLI runs. `scripts/fake-gh.mjs` and `scripts/fake-github-api.mjs` keep their behavior; `answerGh` hands an operation the fixture lacks to the stateful fake when the fixture has one. |
| `scripts/lib/github/*.test.mjs` | Unit tests per module, and `contract.test.mjs` with the suite. |
| `docs/runbooks/issues-github.md`, `scripts/runbook-issues-github.test.mjs` | New. The runbook of the issue flows on GitHub and its E2E test. |
| `docs/runbooks/setup-github.md`, `scripts/runbook-setup-github.test.mjs` | Step 5's `capabilities` expectation changes: estimation, hierarchy, dependencies, metrics and linked code are no longer absent. |
| `docs/adr/0008-...md`, `CONTEXT.md` | An ADR for the archive and linked-branch decisions, and the term **Linked branch**. |

### Ids

`parseIssueId(value, repo)` accepts `12`, `#12` and `owner/name#12`, and returns `{ repo, number }`. `issueIdOf({ repository, number }, repo)` writes the number alone for the scope repository, compared without case, and `owner/name#number` otherwise. Any other string fails with `NOT_FOUND`, `issue <id> does not exist`, before a request. `isIssueId` is true for the forms above. `settings().isEpicId(id)` is `!isIssueId(id)`, so `issues dependencies` sends any other id to `getDeliverable`, which answers `NOT_SUPPORTED` until PMK-88.

A write that would create an issue in, or change the fields of, another repository's issue fails with `INVALID_INPUT`, `the GitHub adapter writes issues of acme/widgets only`. Links and parents may point to another repository's issue, because GitHub allows them.

### Discovery, cache and mapping check

The repository query adds `id`, `labels { nodes { id name } }`, `viewer { id login name }` and `assignableUsers(first: 100) { nodes { id login name } pageInfo }`, paged to 10 pages. `discover().members` lists them as `{ id: login, name, email: null }`, with the viewer first when GitHub leaves the viewer out **(builder's call)**.

The tracker keeps the raw discovery as the Linear tracker does: a memo per run, then the user store (`cacheGet` and `cachePut`, key `github-<host>-<owner>/<name>`, one hour), then GitHub. `discover({ refresh: true })` reads GitHub and refreshes the cache; `pmkit discover` and setup pass it, so they show the live state. `discover()` without it reads through the memo and the cache.

Every operation but `discover` and `capabilities` runs through `guarded`: it checks `tracker.scope.host` and `repo`, then `brokenGithubMappings` on the raw discovery. A broken list from the cache triggers one refresh and a second check. A mapping still broken fails with `NOT_CONFIGURED`, `a mapping in .pmkit/config.yaml names something GitHub no longer has: ...`, next step `/pmkit:setup`, and `details.mappings`, the shape the conventions read.

### The issue fragment

One fragment, built per host:

```graphql
fragment PmkitIssueFields on Issue {
  id number title body state stateReason createdAt updatedAt url
  repository { nameWithOwner }
  author { login }
  issueType { name }
  assignees(first: 10) { nodes { login } }
  labels(first: 50) { nodes { name } pageInfo { hasNextPage } }
  parent { number repository { nameWithOwner } }
  subIssues(first: 50) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage } }
  blockedBy(first: 50) { nodes { number state stateReason repository { nameWithOwner } <status of its item> } pageInfo { hasNextPage } }
  blocking(first: 50) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage } }
  duplicateOf { number repository { nameWithOwner } }
  relatesTo(first: 50) { ... }                       # github.com and GHE.com only
  linkedBranches(first: 5) { nodes { ref { name } } }
  projectItems(first: 20, includeArchived: true) { nodes { id isArchived project { id } status: fieldValueByName(name: "Status") { ... } f0: fieldValueByName(name: "<mapped Project field>") { ... } } }
  issueFieldValues(first: 20) { ... }                # github.com, GHE.com, GHES 3.21+
}
```

The adapter reads the item of the configured Project only. A nested connection with `hasNextPage` gets its remaining pages read before the issue is mapped, as on Linear **(builder's call)**.

### The issue model

| pmkit field | From GitHub |
|---|---|
| `id` | `issueIdOf(node)` |
| `title` | `title` |
| `status` | `{ name, category }` by the settled rule. `name` is the item's Status option, else `Open` or `Closed`. |
| `type` | The pmkit type whose `mappings.types` value is `issueType.name`. Unset when none matches. |
| `priority` | The mapped priority field's option, by the priority rule below. |
| `estimate` | The mapped estimate field: a number, or a size name for a single select. |
| `due` | The mapped `target_date` field, `YYYY-MM-DD`. |
| `assignee` | The first assignee's login. GitHub allows several; pmkit shows the first **(builder's call)**. |
| `labels` | Label names, sorted. |
| `parent` | `issueIdOf(parent)` |
| `children` | `subIssues` ids, in GitHub's order. |
| `blockedBy`, `blocks` | `blockedBy` and `blocking` ids, sorted with `compareIds`. |
| `related` | `relatesTo` ids where the host has them, else `[]`. |
| `duplicateOf` | `[issueIdOf(duplicateOf)]`, or `[]`. |
| `archived` | The configured Project's item has `isArchived: true`. |
| `branch` | The first linked branch's `ref.name`. |
| `description`, `acceptanceCriteria` | `body` through the shared `parseDescription`: the `## Acceptance criteria` checklist, as on Linear. |
| `created`, `updated` | `createdAt`, `updatedAt` |
| `sprint`, `milestone`, `release` | Unset (PMK-88). |

**Priority rule (builder's call).** The mapped field is a single select. An option whose name is `urgent`, `high`, `medium` or `low`, compared without case, is that priority. Otherwise options map by position: the first is `urgent`, then `high`, `medium`, `low`, so P0 to P3 read as expected. A fifth option and later read as unset, and `discover` warns. A write picks the option the same rule gives.

### Writes

Every check runs before any mutation, and a dry run runs the same checks and returns `after` built by the same mapping code.

| Key | Create | Update | GitHub |
|---|---|---|---|
| `title` | required | yes | `title`, one line |
| `description`, `acceptanceCriteria` | yes | yes | `body`, rebuilt by `buildDescription` |
| `type` | yes | yes, `null` clears | `issueTypeId` of `mappings.types[type]` |
| `labels` | yes | yes | `labelIds`; an unknown name refreshes the discovery once, then fails with `INVALID_INPUT`, next step `Create the label on GitHub, then run pmkit discover` |
| `assignee` | yes | owned by `issues assign` | `assigneeIds` |
| `status` | yes | owned by `issues move` | the move below, after the create |
| `priority`, `estimate`, `due` | yes | yes, `null` clears | the mapped field: `setIssueFieldValue` for `issue:`, `updateProjectV2ItemFieldValue` or `clearProjectV2ItemFieldValue` for `project:`; a role mapped `none` or absent fails with `NOT_SUPPORTED`, next step `/pmkit:setup` |
| `parent` | an issue id | owned by `issues parent` | `parentIssueId` on create |
| `branch` | no | yes | the linked branch below |
| `sprint`, `milestone`, `release` | `null` only | `null` only | none; a value fails with `NOT_SUPPORTED` (PMK-88) |

`createIssue` sends `createIssue`, then `addProjectV2ItemById` when a Project is configured, then the field and status writes. A failure after the first mutation fails with `UPSTREAM`, `GitHub created issue <id>, but <step> failed: ...`, next step `pmkit issues get <id>, then repeat the step that failed`, so the user knows the issue exists **(builder's call)**. GitHub has no client-chosen id, so an unconfirmed `createIssue` keeps the client's error, whose next step already says to check GitHub before retrying.

`updateIssue` sends `updateIssue` for the issue's own keys and one write per changed field, and skips each one that changes nothing. A patch that changes nothing sends nothing.

The actor is the viewer, the login of `gh`. A write whose `actor` is another member fails with `INVALID_INPUT`, `GitHub records every write as the gh login (<login>)`, next step `Drop --as, or log gh in as that user`, as Linear does.

### `moveToCategory` (criterion 2)

`moveToCategory(id, category, actor, { status, dryRun })`:

1. Check `category`, then read the issue.
2. Pick the target option: `status` when given, which must be an option whose category is `category`; else `mappings.status[category]` when set and not `none`; else no option.
3. Pick the target state: closed `COMPLETED` for `done`, closed `NOT_PLANNED` for `canceled`, open for every other category.
4. With no option, `done` and `canceled` still close the issue and keep its option, because the reading rule makes a closed issue `done` or `canceled` whatever its option. Any other category without an option fails with `NOT_SUPPORTED`, `no Status option of <owner/number> stands for <category>`, next step `/pmkit:setup`.
5. Send only what changes, in this order: `addProjectV2ItemById` when the issue has no item in the Project, `updateProjectV2ItemFieldValue` with the option, then `closeIssue` or `reopenIssue`. A closed issue whose reason differs from the target is reopened and closed again with the new reason **(builder's call)**.
6. An issue already at the target returns `{ before, after: before }` and sends nothing.

With `tracker.scope.project: none`, `todo` reopens, `done` closes as completed and `canceled` closes as not planned. Every other category fails with `NOT_SUPPORTED`, `tracker.scope.project is none, so issues have no status but open and closed`, next step `/pmkit:setup`.

### `assign`, `archive` and `delete`

`assign(id, who, actor)` takes a login, `me` or `null`. The login must be an assignable user, else the discovery refreshes once and then `INVALID_INPUT`. It sends `updateIssue(assigneeIds: [id])`, or `[]` to unassign, which replaces every assignee. It skips the mutation when the first assignee is already `who` and no other assignee exists.

`archive(id, actor)` sends `archiveProjectV2Item` for the issue's item in the Project, and skips it when the item is already archived. An issue with no item fails with `INVALID_INPUT`, `<id> is not in <owner/number>`, next step `pmkit issues move <id> <category> adds it`. With no Project: `NOT_SUPPORTED`, next step `Set tracker.scope.project with /pmkit:setup`.

`delete(id, actor)` reads the issue and refuses with `CONFLICT` through `referencedError` when another issue references it, as on Linear: it blocks one or is the parent of one. GitHub has no list of the issues marked as duplicates of an issue, so the result names that check under `unchecked` **(builder's call, found in Task 8)**. Then it sends `deleteIssue`. GitHub refuses it for a user who is not a repository admin; the client turns that refusal into `AUTH`. `restore` and `unarchive` answer `NOT_SUPPORTED`.

### Relations

| pmkit | GitHub |
|---|---|
| `link(a, b, 'blocks')` | `addBlockedBy(issueId: b, blockingIssueId: a)` |
| `unlink(a, b, 'blocks')` | `removeBlockedBy(issueId: b, blockingIssueId: a)` |
| `link(a, b, 'related')` | `addRelatesTo(issueId: a, relatedIssueId: b)`; on GHES `NOT_SUPPORTED`, `GitHub Enterprise Server has no related issues` |
| `unlink(a, b, 'related')` | `removeRelatesTo`, same host rule |
| `link(a, b, 'duplicate')` | `closeIssue(issueId: a, stateReason: DUPLICATE, duplicateIssueId: b)`, with the note `GitHub closed <a> as a duplicate of <b>` |
| `unlink(a, b, 'duplicate')` | `unmarkIssueAsDuplicate(duplicateId: a, canonicalId: b)`; the issue stays closed |
| `setParent(id, parent)` | `addSubIssue(issueId: parent, subIssueId: id, replaceParent: true)`; `null` sends `removeSubIssue` for the current parent |

Both issues are read first. A link that exists, or an unlink with nothing to remove, sends nothing and returns `{ before, after: before }`. A self link and an unknown kind fail with `INVALID_INPUT`. A `blocks` link or a parent that would close a loop fails with `INVALID_INPUT` and the loop as `12 → 14 → 12`, checked by reading `blockedBy` or `parent` up to 10 levels, as on Linear. The result is `{ before, after }` of the first issue, read again after the mutation.

### Search: Native search (criterion 1)

`searchIssues(filter)` checks the filter with the shared `checkFilter`, then reads `repository.issues(first: 100, after, orderBy: { field: CREATED_AT, direction: ASC }, filterBy)`:

| pmkit key | `filterBy` | Client step |
|---|---|---|
| `categories` | `states: [OPEN]` when no listed category is `done` or `canceled`; none otherwise, because an open issue can sit in a `done` option | Keep issues whose category is listed. An empty list returns `[]` with no request. |
| `assignee` | `assignee: <login>`, the viewer's login for `me` | `none`: keep issues with no assignee |
| `types` | `type: <issue type>` for one type | Several types: keep matching issues |
| `labels` | `labels: [...]`, which matches any | Keep issues that have every label |
| `updatedAfter` | `since` | Keep `updated > updatedAfter`, since `since` includes the instant |
| `updatedBefore` | | Keep `updated < updatedBefore` |
| `text` | | Substring of title or body, without case, as Local |
| `parent` | | An issue id: keep its children |
| `blocked` | | `true`: keep issues with a blocker whose category is not terminal; `false`: drop them |
| `archived` | | Without `archived: true`, drop issues whose item is archived |
| `sort`, `limit` | | The shared comparator, then the cut |
| `sprint`, `release` | | `NOT_SUPPORTED` (PMK-88) |

The client pages up to 10 pages, 1000 issues. The result is `{ issues, problems: [], hasMore }`, and `issues list` already warns when `hasMore` is true. The server order is pmkit's default order, so with no client step and the `created` sort the read stops at `limit`.

### History and comments

`getHistory(id, { since })` reads `timelineItems(first: 100, itemTypes: [...], since)`, paged, and maps each item to a pmkit event `{ at, by, op, field, from, to }`:

| Timeline item | Event |
|---|---|
| (the issue itself) | `create`, at `createdAt`, by `author.login` |
| `IssueComment` | `comment` |
| `RenamedTitleEvent` | `update`, field `title` |
| `LabeledEvent`, `UnlabeledEvent` | `update`, field `labels`, `to` or `from` the label |
| `IssueTypeAddedEvent`, `IssueTypeChangedEvent`, `IssueTypeRemovedEvent` | `update`, field `type`, the pmkit type when mapped, else the issue type name |
| `AssignedEvent`, `UnassignedEvent` | `assign`, field `assignee` |
| `ClosedEvent`, `ReopenedEvent` | `move`, field `status`, to `Closed` (completed or no reason) or `Closed as not planned` (not planned or duplicate); a reopen goes to the status name the open issue reads now, else `Open` |
| `ProjectV2ItemStatusChangedEvent` (github.com, GHE.com, GHES 3.21+) | `move`, field `status`, the names of the two options |
| `BlockedBy*`, `Blocking*`, `ParentIssue*`, `SubIssue*`, `MarkedAsDuplicate`, `UnmarkedAsDuplicate` events | `link` or `unlink`, field `blockedBy`, `blocks`, `parent`, `children` or `duplicateOf` |

`by` is the actor's login, `null` for a deleted account. Events sort by `at`. Move events carry status names, as Linear's do, because the metrics map names to categories through `discover().statuses`. `discover().statuses` therefore lists `Open` (`todo`), `Closed` (`done`) and `Closed as not planned` (`canceled`) after the Status options, each only when no option has that name, and `moveToCategory` accepts these names in `status` as targets with no option: they open or close the issue and keep its option. `Open` counts only when no option maps to `todo` **(rulings during Task 10)**. On GHES 3.19 and 3.20 the Status option changes have no events, and the result's `warnings` on `getHistory` says that status moves show only as opens and closes there **(builder's call)**.

`listComments(id)` reads `comments(first: 100)`, paged, as `{ id, issue, author, body, created }`. `comment(id, body, actor)` sends `addComment` and refuses an empty body with `INVALID_INPUT`. `replyTo` and `resolveThread` answer `NOT_SUPPORTED` (decision 4).

`metricEvents({ since, until })` reads the issues updated since `since` through `repository.issues`, most recently updated first, so the cap keeps the issues the metrics need, then their timelines through `nodes(ids)` in batches of 20, so one call reads 20 timelines **(builder's call: one `gh` process per issue would take minutes on a busy repository)**. It tags each event with `issue`, filters by `until`, and sorts by `at`. It keeps the 1000-issue cap and returns `hasMore` through a warning.

### The issue's branch (decision 6)

`updateIssue(id, { branch })`:

- When `issue.branch` equals `branch`, it succeeds and sends nothing.
- When the issue has another linked branch, it fails with `INVALID_INPUT`, `GitHub links <id> to branch <name> already`. `settings().trackerBranch: true` makes `issues branch` use that name, so this happens only when a user picks another name by hand.
- Otherwise it reads `repository.ref(qualifiedName: "refs/heads/<base>") { target { oid } }` and sends `createLinkedBranch(issueId, repositoryId, name, oid)`. A dry run reads the oid and sends nothing.

`base` comes from the caller as `updateIssue(id, { branch }, actor, { base })`. `issues branch` passes the branch it starts from, without `origin/`: pmkit's default branch, the `branch` of `default-branch --json` (`git_host.default_branch`, else `origin/HEAD`), or the `--from` ref. GitHub's own default branch (`defaultBranchRef`) is never used, because a repository whose GitHub default is `main` while pmkit works from `develop` would get a branch linked at `main`, and the first push of a branch started from `develop` would be non-fast-forward. When `--from` names a ref GitHub does not have, the adapter falls back to pmkit's default branch on GitHub, and the result carries the note `GitHub has no branch <from>, so pmkit linked <branch> at the head of <default> there`. When GitHub lacks that one too, the write fails with `INVALID_INPUT`, `GitHub has no branch <default> to start <branch> from`, next step `Push <default> to origin, or pass --from <a branch on GitHub>` **(correction from the coordinator, 2026-11-16)**.

`issues branch` with `settings().remoteBranch: true` checks, with local refs only, whether `from` contains `origin/<base>`, where `<base>` is the branch the linked branch starts at: `git merge-base --is-ancestor origin/<base> <from>`. When it does not, the result carries the note: `GitHub creates <branch> on origin at the head of <default> there, and <from> lacks commits of origin/<default> (as of the last fetch), so the push of pr open would be refused. Run git fetch origin, then git rebase --onto origin/<default> <from> <branch>` (the dry run says `pass --from origin/<default>` instead). This also covers `--from` a feature branch. The existing PMK-298 notes stay as they are.

### Capabilities

`buildGithubCapabilities(raw, pmkit)` keeps one entry per capability:

| Capability | Path |
|---|---|
| `estimation` | `native` with `{ unit, scale }` when `mappings.fields.estimate` names a field; else `absent`, hint `Map an estimate field with /pmkit:setup` |
| `multilevel_hierarchy` | `native` (sub-issues) |
| `dependencies` | `native`, with `detail.unsupported: ['related']` on GHES |
| `native_metrics` | `derived`, `detail.source: 'history'` |
| `linked_code` | `derived`, as today |
| `native_triage` | `absent`, hint `GitHub has no triage; map a Status option to triage in .pmkit/config.yaml` |
| `agent_delegation` | `absent`, hint `The GitHub adapter does not delegate to agents yet` |
| `time_tracking` | `absent`, hint `GitHub has no time tracking` |
| Every other | `absent`, `The GitHub adapter does not serve <id> yet (EPC-8)` |

`unservedCapabilities` must stay empty for the GitHub manifest; a test checks it.

### Contract suite against the fake

`scripts/lib/github/contract.test.mjs` runs `runTrackerContract` with `families: ['discovery', 'issues', 'relations', 'history']`, over the stateful fake on github.com with a Project whose Status options are Triage, Backlog, Todo, In Progress, In Review, Done and Canceled, each mapped, and three types. `actor` is the fake viewer `octocat`.

`fakeGithubIssues(options)` keeps issues, Project items, comments, timelines, linked branches and the branch heads on GitHub in memory, answers pmkit's documents by operation name, and records each mutation so tests can assert that a dry run sent none. It answers a document it does not know with a GraphQL validation error, so a typo in a query fails the test. It refuses `relatesTo` and `issueFieldValues` when its host is GHES below their version, so the per-host documents are tested too. The fake's behavior comes from the schema facts above, not from GitHub; a live run is a follow-up.

### Runbook

`docs/runbooks/issues-github.md` walks the issue flows on a configured GitHub repository: create an issue with a type and criteria, list it, move it through todo, in progress and done (the issue closes), link a blocker and see `blocked`, set a parent, mark a duplicate (the issue closes as canceled), comment and read the history, record the branch with `issues branch` and see the note, archive it. `scripts/runbook-issues-github.test.mjs` runs each step with the real CLI and a fake `gh` first on `PATH`, whose state persists in a file between runs, and checks that no call carries the token.

## Acceptance criteria map

| Criterion | Where |
|---|---|
| The adapter implements the Issues, Relations, History, Comments and Native search operations | `issue-ops.mjs`, `relation-ops.mjs`, `history-ops.mjs`, `filter.mjs`; the contract suite with four families; the runbook's E2E test |
| `move_to_category` sets the Status option and opens or closes the issue | `moveToCategory` in `issue-ops.mjs`; unit tests for each row of "moveToCategory", and the contract test that moves through every category |

## Testing

- Unit tests with `node:test` for each pure module: ids, the issue model rows, the priority rule, the writes table, each filter row, each timeline row.
- Tracker tests against `fakeGithubIssues`: every operation, each error, a dry run sending no mutation, a broken mapping stopping an operation, the cache refresh, a GHES 3.19 host (no `relatesTo`, no issue fields, the history warning), a write as another actor refused, a partial create.
- CLI tests: `issues branch` on a GitHub tracker with a base behind `origin/<default>` prints the linked-branch note; with an up-to-date base it does not.
- The contract suite for GitHub; Local and Linear runs keep passing with the `threads` family.
- The runbook's E2E test.
- `npm test` passes apart from the four known failures (PMK-333).

## Risks

- Multi-mutation writes are not atomic. A create or a move can stop halfway; the error names what happened and what is left.
- The fake follows the schema, not GitHub's behavior. A live run of the suite is a follow-up.
- `createLinkedBranch` creates a branch on GitHub at once, so a user who abandons `issues branch` leaves a remote branch.
- A search reads at most 1000 issues and filters status on the client, so a large repository pays for every read.

## Left for later issues

- Iterations, milestones and epics (PMK-88); labels and milestones without a Project (PMK-89).
- A live contract run against github.com, and `related` on GHES once GitHub ships it.
