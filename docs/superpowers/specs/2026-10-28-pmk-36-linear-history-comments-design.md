# PMK-36 design: history and comments for Linear

Issue PMK-36, epic EPC-5 (Linear tracker adapter), milestone `linear`. Status: approved. The user answered the three open questions (see "Resolved questions"). Decisions come from an autonomous brainstorming run on 2026-10-28 with no user dialogue, from the issue, ADR-0001, ADR-0003, ADR-0005, the PMK-35 spec, the code, and read-only calls to the sandbox workspace. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion.

## Problem

The Linear tracker reads and writes issues and relations (PMK-35). `getHistory`, `listComments`, `comment` and `metricEvents` are stubs that throw `NOT_SUPPORTED`. So on Linear:

- `issues get --history` and `issues get --comments` fail, and `/pmkit:issues:work`, `/pmkit:issues:summary` and `/pmkit:issues:pause` cannot read an issue's discussion or post to it.
- Every flow metric (`metrics velocity`, `cycle-time`, `lead-time`, `throughput`, `aging`), `events`, `risks` and `/pmkit:team:standup` fail, although the Linear manifest already reports `native_metrics` as `derived` from history (PMK-33, PMK-29: Linear has no Insights API).
- Nothing can resolve a comment thread. The contract has no such operation, and the Local tracker has no threads.

Sources:

- Unified model, "Adapter operations contract": History (`get_history`, "Basis for derived metrics; normalizes status events") and Comments (`list_comments`, `comment`, `resolve_thread`). Metrics (`metric_events`).
- Linear tab, domain 2 ("Activity history: when and why something changed") and domain 10 ("Comments on issues, projects and updates (threads, mentions)", "Resolve threads").
- Technical spec, `IssueEvent`, `Comment` and the event log line (`at`, `by`, `op`, `field`, `from`, `to`, `minutes`, `synthetic`).
- MVP skills, "Contract operations the MVP needs": History `get_history`; Comments `list_comments`, `comment` now, `resolve_thread` later.
- The pmkit design spec, "Common model" (Event, Comment) and "Contract" (History and comments, Metrics).

Acceptance criteria:

1. `get_history` returns status changes as events in the common shape.
2. The adapter lists, adds and resolves comment threads.

Bound decisions from earlier issues:

- The client retries only documents with no mutation, and its page cap is 10 pages when the caller gives no limit (PMK-30).
- Every write appears in Linear as the key's owner. The actor and `me` come from `viewer`, and `--as` with anyone else is refused (ADR-0005, PMK-35).
- `ISSUE_FRAGMENT`, `toIssue`, `resolveMappings` and `guarded` are the one way to read an issue, its mappings and the mapping check (PMK-34, PMK-35).
- A sprint id on Linear is the cycle `number` as a string (PMK-37 spec, not merged). PMK-38 has no spec yet.

## Facts checked against the Linear API

Read-only calls on 2026-10-28 against the sandbox workspace (Free plan), through `createLinearClient` and a fetch wrapper that refused any mutation. The session matched the expected URL key before any read. No write was sent.

| Call | Result |
|---|---|
| `__type(IssueHistory)` | `createdAt`, `actorId`, `actor`, `botActor`, `updatedDescription`, `fromTitle`/`toTitle`, `fromAssigneeId`/`toAssigneeId`, `fromPriority`/`toPriority`, `fromEstimate`/`toEstimate`, `fromDueDate`/`toDueDate`, `fromStateId`/`toStateId` and `fromState`/`toState`, `fromParentId`/`toParentId` and `fromParent`/`toParent`, `fromTeamId`/`toTeamId`, `fromCycle`/`toCycle`, `fromProject`/`toProject`, `fromProjectMilestone`/`toProjectMilestone`, `addedLabelIds`/`removedLabelIds` and `addedLabels`/`removedLabels`, `relationChanges` (`identifier`, `type`), `archived`, `trashed`, `autoClosed`, `autoArchived`, `attachmentId`, `addedToReleaseIds`/`removedFromReleaseIds`, `customerNeedId`, SLA and delegate fields, `changes` (JSON). |
| `__type(Issue)` | `history(first, after, orderBy, ...)` with no filter argument, `comments(filter, first, after, ...)`, `stateHistory` (`IssueStateSpan`: `stateId`, `startedAt`, `endedAt`). `Query` has no top-level history query. |
| `__type(Comment)` | `id`, `createdAt`, `body`, `bodyData`, `user`, `botActor`, `externalUser`, `parent`, `parentId`, `resolvedAt`, `resolvingUser`, `resolvingComment`, `editedAt`, `url`, `children`. |
| `__type(CommentCreateInput)`, `Mutation` | `id` (client-chosen), `body`, `issueId`, `parentId`, `createAsUser` (OAuth apps only). `commentCreate(input)`, `commentResolve(id, resolvingCommentId)`, `commentUnresolve(id)`, `commentUpdate`, `commentDelete`. |
| `issues(first: 250)` with nested `history(first: 50)` and `comments(first: 50)` | 122 issues, 285 history entries, at most 10 on one issue, none with a second page. 230 comments, all by users, none a reply, none resolved. Complexity 507, 776 ms. |
| Entry kinds | Entries holding a state change (160), labels added (54), a project milestone (27), priority (21), relation changes (20), assignee (19), a description change (15), title (6), attachments (4), one label removal. No entry for the creation of an issue. |
| `relationChanges.type` | Only `ar` appears, on issues that gained a `related` relation. No other code occurs in the sandbox. |
| `changes` keys | `toProjectMilestoneId`, `descriptionUpdatedByIds`. |
| Order | `history` and `comments` both return the newest entry first. |
| Comment bodies | No sandbox comment holds an HTML comment (`<!--`) or the word pmkit. |

Consequences for the design:

- Linear records changes, not states, and records no creation entry. The `create` event and the old values of list fields have to be computed.
- Both connections come newest first, so the adapter sorts. Walking newest to oldest from the current issue is the natural order to compute old values.
- `history` takes no `since` filter, so `since` is applied after the read.
- Relation codes other than `ar` are unknown until a live write produces them (PMK-39).

## Goals

- `getHistory(id, { since })` returns the issue's events in the Local event shape, sorted by `at`, with status changes as `move` events on `status`.
- Replaying the events of a Linear issue gives the fields `getIssue` returns, for every field the history covers.
- `metricEvents({ since, until })` returns the events of the scope team's issues, so every flow metric, `events`, `risks` and the standup digest run on Linear with the code they run on Local.
- `listComments`, `comment` and thread resolution work on Linear, with the viewer as the author of every write and `{ dryRun: true }` sending no mutation.
- The contract suite runs its `history` family against the fake Linear in `npm test`.

## Non-goals

- Cycles (PMK-37) and projects, project milestones and documents (PMK-38). This issue emits history events for cycle, project and milestone changes and maps no issue field.
- `logTime`. Linear has no time tracking (manifest `time_tracking: absent`), and the stub stays.
- Editing, deleting or unresolving a comment. `commentUnresolve` exists and no command needs it.
- Comments on projects, project updates and documents. Linear has them; pmkit's Comment belongs to an issue.
- Mentions. A body that names `@someone` goes to Linear as text; pmkit does not resolve mentions.
- The contract suite against the live sandbox (PMK-39) and the degraded paths (PMK-40).

## Anti-goals

- `npm test` opening a socket. Every test injects `fakeLinearFetch`.
- A new dependency (ADR-0003).
- A change to any Local output that has a golden. Every golden stays byte-identical.
- The key in any output, error, cache file or command line (ADR-0005).
- The real workspace URL key or team key in any file. Examples use `acme` and `ACME`.
- A write to Linear from this design work.
- A change to `ISSUE_FRAGMENT`. The history documents add their fields beside it, so the PMK-37 and PMK-38 merges do not conflict on it.

## Approaches

The core choice is how Linear's change records become pmkit events.

1. **Forward translation per entry.** Each history entry becomes its events on its own. The `create` event holds only the title and the first status. It is the simplest, but list fields break the Local shape: a Local `labels` event carries the whole list before and after, and an entry only says which labels were added. Replay gives an issue that differs from `getIssue`.
2. **Rewind from the current issue.** Read the issue through `ISSUE_FRAGMENT` and map it with `toIssue`. Walk the entries from newest to oldest. Each entry gives its events, and undoing it on the running state gives the values before it. After the oldest entry, the running state is the issue at creation, which becomes the `create` event's `to`. Every event has the Local shape, list fields included, and replay reproduces the current fields by construction.
3. **State spans only.** `Issue.stateHistory` gives each state with `startedAt` and `endedAt`, which is all the flow metrics need. It costs the least, but `getHistory` would drop assignees, titles, labels and relations, `aging` and `risks` would miss activity, and the standup digest would show only moves.

Chosen: approach 2. It is the only one whose output has the Local shape for every field, and the replay check makes it testable against the fake and the sandbox.

The user chose where thread resolution lives (resolved question 1): a contract operation that the Local tracker implements first.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/linear/history.mjs` | New, pure. `toEvents({ node, origin, entries, comments }, context)` returns the events of one issue. `toComment(node)` returns a pmkit comment. The relation code table and the actor rule. |
| `scripts/lib/linear/history-ops.mjs` | New. `getHistory`, `listComments`, `comment`, `resolveThread` and `metricEvents` over the client, built on `issueOperations` (`readNode`, `contextFor`, `requireViewer`, `completeNested`). |
| `scripts/lib/linear/documents.mjs` | New documents: `PmkitIssueHistory`, `PmkitIssueComments`, `PmkitCommentById`, `PmkitCommentCreate`, `PmkitCommentResolve`, `PmkitIssueEvents`. `ISSUE_FRAGMENT` does not change. |
| `scripts/lib/linear/tracker.mjs` | Puts the five operations in the `contract` map, so `guarded` wraps them. |
| `scripts/lib/contract.mjs` | `resolveThread` joins `TRACKER_OPERATIONS` (resolved question 1). |
| `scripts/lib/local/tracker.mjs` | `comment` takes `{ replyTo }`, `resolveThread` is new, `readComment` reads the thread keys (resolved question 1). |
| `scripts/pmkit.mjs` | `issues comment --reply-to <comment>`, `issues resolve <id> <comment>`, thread lines in the `issues get --comments` text when a comment has them, and the cap warnings. |
| `scripts/contract-suite.mjs` | The `log_time` steps leave the `history` test, and a thread test joins it. |
| `scripts/fake-linear-api.mjs` | `fakeLinearIssues` records history entries and comments and answers the new documents. |
| `commands/issues/comment.md` | A reply and a resolve path (resolved question 1). |
| Docs | The pmkit design spec (Comment entity, the contract table), `CONTEXT.md` (a **Thread** entry), `CHANGELOG.md`. |
| Tests | `scripts/lib/linear/history.test.mjs` (new), `tracker.test.mjs`, `contract.test.mjs`, `fake-linear-api.test.mjs`, `cli-linear.test.mjs`, `scripts/tracker-comments.test.mjs`, `scripts/contract.test.mjs`, an opt-in case in `client-live.mjs`. |

### The event normalizer

`toEvents` takes the issue node (fragment-shaped, nested lists complete), its origin (`createdAt`, `creator`, `botActor`), its history entries and its comments, all in any order. It returns events with the Local keys in the Local order (`at`, `by`, `op`, `field`, `from`, `to`), sorted by `at`. Events with the same `at` keep the order they were built in.

`at` is the entry's `createdAt` as Linear sends it, ISO 8601 UTC with milliseconds, as PMK-35 does for `created` and `updated`. The metrics parse it with `eventInstant` or `Date.parse`, and a `since` of `2026-10-01` compares with it as a string the same way it does on Local.

`by` is the member id of the actor, which on Linear is the user's id, the same id `assignee` holds. Without a user, it is `bot:<botActor.type>` when Linear names a bot, else `linear` for changes Linear made itself, such as an auto-close **(builder's call)**. The same rule gives a comment's `author`, with `external:<externalUser.id>` for a comment synced from outside Linear.

#### What each history field becomes

The running state starts as the current issue: `toIssue(node)`, plus `sprint` and `milestone` from the node when PMK-37 and PMK-38 add them. An entry yields the events below, in the order of the table. Each event's `to` is the running value, and its `from` is the value the entry says came before. Then the entry is undone on the running state.

| Linear entry fields | pmkit event | Values |
|---|---|---|
| `fromState`, `toState` | `move`, field `status` | State names. A state Linear no longer returns takes its name from the discovery by id, else `null`. |
| `fromAssigneeId`, `toAssigneeId` | `assign`, field `assignee` | Member ids, `null` for unassigned. |
| `fromTitle`, `toTitle` | `update`, field `title` | Strings. |
| `fromPriority`, `toPriority` | `update`, field `priority` | `priorityOf`: `urgent` to `low`, `null` for 0. |
| `fromEstimate`, `toEstimate` | `update`, field `estimate` | The number, or the size on a t-shirt team, as `toIssue` maps it. No event when `resolveMappings(...).estimate` is not `native`, because the issue then reads with no estimate. |
| `fromDueDate`, `toDueDate` | `update`, field `due` | `YYYY-MM-DD` or `null`. |
| `addedLabels`, `removedLabels` (ids as fallback) | `update`, field `type`, then `update`, field `labels` | `type` through `typeOf` on the label set before and after, only when it changes. `labels` as the whole sorted list before and after without the type labels, only when it changes. This is the Local shape. |
| `fromParent`, `toParent` | `update`, field `parent` | Identifiers or `null`. |
| `relationChanges` with a known code | `link` or `unlink`, field `blocked_by`, `related` or `duplicate_of` | `to` is the other issue's identifier, as Local logs it. |
| `fromCycle`, `toCycle` | `update`, field `sprint` | `String(cycle.number)`, PMK-37's sprint id, or `null`. |
| `fromProject`, `toProject` | `update`, field `project` | The project's id, or `null` (see "What PMK-37 and PMK-38 get"). |
| `fromProjectMilestone`, `toProjectMilestone` | `update`, field `milestone` | The milestone's id, or `null`. |
| `updatedDescription: true` | `update`, field `description` | No `from` or `to`, as the Local body fields. Linear keeps acceptance criteria in the description (PMK-35), so a change to them reads as a description change. |
| `archived: true` | `archive` | None. `autoArchived` entries count, with `by` from the actor rule. |

The `create` event comes first, with `at` from `createdAt`, `by` from the creator through the actor rule, and `to` holding the running state after the oldest entry is undone. It has the keys Local's `create` has: `id`, `title`, `type`, `status`, `priority`, `estimate`, `assignee`, `labels`, `parent`, `blocked_by`, `related`, `duplicate_of`, `sprint`, `milestone`, `due`, `created`. Keys with no value are left out, as `toFrontmatter` leaves them.

An entry that yields no event, such as an attachment, is dropped. An entry with several changes, such as a state and an assignee, yields several events with one `at`.

#### What has no equivalent

| Linear | Why it has no event |
|---|---|
| `fromTeam`, `toTeam` | A team move gives the issue a new identifier. pmkit has no field for the team, and the move's state change still appears as a `move`. Old identifiers in other issues' events stay as Linear recorded them. |
| `trashed` | A trashed issue reads as `NOT_FOUND` (PMK-35), so its history is never read. |
| Unarchive | The Local tracker has no unarchive and no event for it. |
| `attachmentId` | Attachments, including pull request links, are not issue fields. `linked_code` comes from the git host. |
| `addedToReleaseIds`, `removedFromReleaseIds` | Releases need the Business plan and no issue maps them. |
| SLA, `customerNeedId`, delegate, triage responsibility, `workflowMetadata`, `descriptionUpdatedBy` | No pmkit field. |
| `similar` relations | PMK-35 ignores them. |
| `stateHistory` | The state changes in `history` already hold the same moves. One source keeps both reads in agreement. |

#### Relation codes

`relationChanges` gives the other issue's identifier and a short code. The sandbox shows only `ar`, on an issue that gained a `related` relation, so the table starts with one verified row:

| Code | Event | Verified |
|---|---|---|
| `ar` | `link`, field `related` | sandbox read, 2026-10-28 |

Codes not in the table yield no event, and the undo step leaves the relation lists unchanged for them. The table is the one place PMK-39 extends when its live writes show the codes for removal, blocks and duplicates and their directions. Until then, `blocked_by` and `duplicate_of` lists in the `create` event are the current lists, which is right for any issue whose blocks and duplicate relations did not change after creation.

#### Status by category

A `move` event names states, as on Local. Every consumer already turns a name into a category with `categoryLookup(discover().statuses)`, and the Linear `discover()` builds `statuses` from the scope team's states with `mappings.status` applied (PMK-33, PMK-34 rule 1). So the flow metrics, `aging` and `risks` see `in_review` for the state that `mappings.status.in_review` names, with no Linear code in `metrics.mjs`.

Because history entries point at the state object, an event names the state's current name. A state renamed in Linear reads with its new name in old events, which matches `discover()`. A state of another team with a name the scope team lacks maps to `null`, and the metrics skip that move, as they skip a Local status that left the config.

#### Comments in the history

Each comment adds `{ at: createdAt, by: author, op: 'comment', to: <comment id> }`, as Local's `comment` event names the comment file. A resolved thread adds `{ at: resolvedAt, by: <resolving user>, op: 'comment', field: 'resolved', to: <root comment id> }`. `stalled` counts them as activity, and the standup digest lists them, as on Local.

### `getHistory(id, { since })` (criterion 1)

1. `readNode(id)`, which checks the id, includes archived issues, and fails with `NOT_FOUND` for a missing or trashed one.
2. `PmkitIssueHistory` with the node's UUID, through `paginate` at 100 entries per page. The first page also selects `creator { id }` and `botActor { type name }` of the issue.
3. `PmkitIssueComments` the same way.
4. `toEvents` with `contextFor([node])`, then the `since` filter, `at >= since`, as Local applies it.

Each read stops at the client's cap of 10 pages, 1000 entries or comments. When a cap cuts a read, the walk lacks the oldest entries, so the `create` event's values are the state before the oldest entry read. The result array then carries a non-enumerable `truncated: true`, defined as `discover()` defines `raw`, and `issues get --history` warns `Linear has more history for <id> than the 1000 entries pmkit read; the oldest are missing`. The sandbox's largest issue has 10 entries.

### `metricEvents({ since, until })`

The flow metrics read whole logs, so this operation reads every issue of the scope team with its history and comments in one paged query.

1. `PmkitIssueEvents` selects `...PmkitIssueFields`, the origin, `history(first: 50)` and `comments(first: 50)` per issue. Variables: the team filter from `translateFilter`, `includeArchived: true`, and `updatedAt: { gte: since }` when `since` is given.
2. `sort: [{ updatedAt: { order: Descending } }]`, so a cut keeps the most recently updated issues, which the metrics need most **(builder's call)**.
3. Pages of 100 issues, 10 pages at most, 1000 issues. An issue whose nested history or comments report `hasNextPage` gets the rest through the `getHistory` documents, and `completeNested` completes its fragment lists.
4. For each issue that is not trashed, `toEvents`, each event tagged with `issue`. Then Local's range rule: `since` as `at >= since`, and a date-only `until` that includes the whole day.
5. Sorted by `at`, then by issue id with `compareIds`, then in the issue's own order.

When the page cap cuts the read, the array carries the non-enumerable `truncated: true`. `events` and the flow metrics commands then warn `Linear has more issues than the 1000 pmkit read; the result covers the 1000 most recently updated`.

A page of 250 sandbox issues with both nested connections cost 507 complexity, so a page of 100 stays well inside Linear's limits.

### Comments and threads (criterion 2)

#### The comment model

`toComment(node)` returns the common Comment, with two optional keys for threads:

| pmkit key | From Linear |
|---|---|
| `id` | `id`, the comment's UUID |
| `issue` | the issue's identifier |
| `author` | the actor rule on `user`, `botActor` and `externalUser` |
| `body` | `body`, trimmed |
| `created` | `createdAt` |
| `parent` | `parentId`, only on a reply. Linear threads are one level deep, so it is the root comment. |
| `resolved` | `{ at: resolvedAt, by: resolvingUser.id }`, only on a resolved root |

A Local comment without the thread keys keeps today's shape, so every Local output and golden stays the same.

#### `listComments(id)`

`readNode(id)`, then `PmkitIssueComments` through `paginate` at 100 per page with the 10-page cap and the same `truncated` flag. Roots and replies come back in one list, sorted by `created`, then by `id`, as Local sorts. A command groups a thread by `parent`.

#### `comment(id, body, actor, { dryRun, replyTo })`

1. `requireViewer(actor)`, so any other actor fails with PMK-35's `INVALID_INPUT`.
2. The body is trimmed. An empty body fails with `INVALID_INPUT`, `comment body must be a non-empty string`, as on Local.
3. `readNode(id)`. With `replyTo`, the comment must exist on that issue, read through `PmkitCommentById`; otherwise `NOT_FOUND`, `comment <replyTo> is not on <id>`. A reply to a reply attaches to the root, because Linear allows one level.
4. A dry run returns `{ id: null, issue, author: viewer.id, body, created: <now>, parent? }` and sends nothing. The CLI prints the issue as it does for Local.
5. `commentCreate({ id: <client UUID>, issueId: <issue UUID>, body, parentId? })`, once. The result is `toComment` of the payload's comment.
6. An unconfirmed create (the client's `UPSTREAM` "Linear did not confirm the change") reads the UUID once with `PmkitCommentById`. If the comment exists, the operation returns it; else the original error propagates. This is PMK-35's rule for creates.

`me` needs no resolution here: the author of every comment pmkit writes is the viewer, and `listComments` returns member ids.

#### `resolveThread(id, commentId, actor, { dryRun })`

1. `requireViewer(actor)` and `readNode(id)`.
2. Read the comment. A comment on another issue or a missing one fails with `NOT_FOUND`. A reply resolves its root.
3. A root that is already resolved returns `{ before, after: before }` and sends nothing.
4. A dry run returns `{ before, after }`, where `after.resolved` is `{ at: <now>, by: viewer.id }`.
5. `commentResolve(id: <root UUID>)`, and `after` is `toComment` of the payload. Resolving is idempotent, so the client's single send is enough.

#### pmkit markers in comments

pmkit adds nothing to a body. It sends the trimmed text the user saw in the dry run, and reads Linear's `body` back. A comment pmkit wrote reads back with the same text as long as Linear's editor keeps the Markdown. Linear stores the comment as a document (`bodyData`) and regenerates `body`, so it may rewrite bullets, escapes or HTML.

No pmkit feature depends on a marker inside a comment. A retry after an unconfirmed create finds the comment by its client UUID. Every comment pmkit writes has the viewer as author, so there is no other author to recover. A body that holds a marker, such as a line starting with `<!-- pmkit`, goes to Linear as written, and no sandbox comment shows whether Linear keeps an HTML comment. PMK-39 posts one comment with a marker line, a checklist and a code fence, reads it back and records which survive. Resolved question 3: pmkit does not mark its comments.

### The Local tracker and threads (resolved question 1)

With the recommended answer, the Local tracker defines what threads mean before Linear implements them (ADR-0001):

- `comment(id, body, actor, { dryRun, replyTo })` writes `reply_to: <root comment id>` in the new comment's frontmatter. A reply to a reply takes the root. A missing `replyTo` fails with `NOT_FOUND`. The event stays `{ op: 'comment', to: '<name>.md' }`.
- `resolveThread(id, commentId, actor, { dryRun })` adds `resolved: <timestamp>` and `resolved_by: <member>` to the root's frontmatter and logs `{ op: 'comment', field: 'resolved', to: '<root>.md' }`. An already resolved root writes nothing.
- `readComment` maps `reply_to` to `parent` and the two resolved keys to `resolved`. A comment file without them reads as today.
- The keys are optional, so the tracker format stays 2. An older CLI reads a reply as a plain comment and does not see the resolution **(builder's call)**.
- Resolving rewrites one comment file, which comments never did before. Two people resolving the same thread on two branches get a git conflict in that file, which `/pmkit:local:doctor` already reports.

### CLI

- `issues comment <id> --body-file f [--reply-to <comment>]`.
- `issues resolve <id> <comment>`, a write with `--dry-run` and `--json`, which prints `resolved the thread <root> on <id>`.
- `issues get --comments` adds `(reply to <parent>)` after the author of a reply and a line `resolved <at> by <by>` under a resolved root. A comment without the keys prints as today, so the Local goldens stay the same.
- The cap warnings above, on `issues get --history`, `issues get --comments`, `events` and the `metrics` commands.

`commands/issues/comment.md` gains an optional `reply-to` parameter and a short path for "resolve the thread", each with the dry run and the one confirmation the conventions require.

### Contract suite

- The test "keeps comments and history in the order the writes happened" (family `history`) loses its `logTime` steps, which the existing test "logs time on an issue and shows it in the history and the metric events" (`history`, `time`) already covers. It then expects the ops `create`, `update`, `comment`, and the Local runs still run both tests.
- A new `history` test: comment, reply with `replyTo` on the root, list both with `parent` on the reply, resolve through the reply, resolve again with no change, resolve an unknown comment with `NOT_FOUND`, and find the `comment` event with field `resolved` in the history.
- A new `history` test for metric events: two issues with writes, `metricEvents()` holds each issue's events tagged with its id and sorted by `at`, and a `since` after the first writes drops them.
- `scripts/lib/linear/contract.test.mjs` adds `history` to its families. `time` stays out, so the log-time test is skipped on Linear with the reason `needs the time family`.

### The fake

`fakeLinearIssues` gains a history list and a comment list:

- `PmkitIssueUpdate` appends one entry with the from and to fields of every changed input field (state, assignee, title, priority, estimate, due date, parent, labels as added and removed, cycle, project, milestone) and `updatedDescription` when the description changes. `PmkitIssueArchive` appends `archived: true`. `PmkitRelationCreate` of type `related` appends `ar` entries on both issues. Other relation types append nothing, as the table knows no code for them.
- `PmkitCommentCreate` honors the client `id` and `parentId` and refuses a parent that is itself a reply. `PmkitCommentResolve` sets `resolvedAt` and `resolvingUser`.
- `PmkitIssueHistory`, `PmkitIssueComments` and the nested connections of `PmkitIssueEvents` answer newest first, as Linear does, so a test fails if the adapter forgets to sort.
- `history(ref, entry)` and `comment(ref, input)` seed records without recording a mutation, for entries pmkit never produces: bot actors, auto-close, team moves, unknown relation codes, external authors.
- `unconfirm('PmkitCommentCreate', { applied })` works as it does for issue creates.

## Testing

No test opens a socket.

- `history.test.mjs`: every row of the field table, both no-equivalent tables, the actor rule (user, bot, Linear, external), estimate events dropped when the estimate is not native, a t-shirt estimate, a type label change giving a `type` event and no `labels` event, an unknown relation code giving no event, events sorted from a newest-first input, and the `create` event built by undoing every entry. The replay check: for issues built from seeded entries, `replay(toEvents(...))` equals the issue's `title`, `type`, `status`, `priority`, `estimate`, `assignee`, `labels`, `parent`, `related` and `due`.
- `tracker.test.mjs`: `getHistory` with `since`; the cap flag on history, comments and metric events; `comment` with `--as` another member refused; a dry run of `comment` and `resolveThread` sends no mutation and returns the same shape as the real write; an unconfirmed comment that exists returns it and one that does not rethrows; a reply to a reply attaches to the root; `metricEvents` sends the `updatedAt` filter for `since`.
- `contract.test.mjs` under `scripts/lib/linear/`: the suite with `discovery`, `issues`, `relations` and `history`.
- `tracker-comments.test.mjs` and `scripts/contract.test.mjs`: the Local reply, resolve and read-back cases; the Local runs still run every test.
- `cli-linear.test.mjs`: `issues get --history` and `--comments` on the fake, the reply and resolve commands, `metrics cycle-time` on Linear giving the same days as the same moves on Local, and the warnings.
- Every golden stays byte-identical.
- An opt-in live case in `client-live.mjs` behind `PMKIT_LIVE=1`, read-only: `getHistory` on a few sandbox issues, every entry either mapped or in a no-equivalent row, events sorted, and the replay check against `getIssue`; `metricEvents()` with its page count and complexity. Writes stay for PMK-39.

## What PMK-37 and PMK-38 get

- Cycle changes emit `{ op: 'update', field: 'sprint', from, to }` with `String(cycle.number)`, the sprint id the PMK-37 spec chose, so `sprintIssues` and `velocity` read Linear history as they read Local. If PMK-37 changes the id, one function in `history.mjs` changes, and nothing is stored, because Linear history is read fresh on each call.
- Project changes emit `{ op: 'update', field: 'project', from, to }` with the project's id, and milestone changes `{ op: 'update', field: 'milestone', from, to }` with the project milestone's id. Assumed: PMK-38 maps a project to an epic and a project milestone to a milestone, each by one id function. If PMK-38 shows a project as the issue's `parent`, it renames the field in one table row.
- When `toIssue` starts to fill `sprint`, `milestone` or the project, the replay check in `history.test.mjs` gains those fields.
- The history documents select their fields beside `...PmkitIssueFields`, so neither merge conflicts on the fragment.

## Acceptance criteria map

| Criterion | Design part |
|---|---|
| 1. `get_history` returns status changes as events in the common shape | "The event normalizer" (the field table, `move` on `status` with state names, the `create` event by rewinding, no-equivalent rows, relation codes), "Status by category", "`getHistory`" (paging, cap, `since`), "`metricEvents`" for the metrics that read history; the replay check in `history.test.mjs`; the `history` family of the suite against the fake; the opt-in live replay check |
| 2. The adapter lists, adds and resolves comment threads | "Comments and threads" (`toComment`, `listComments`, `comment` with `replyTo`, `resolveThread`, markers), "The Local tracker and threads", "CLI"; the suite's thread test on Local and Linear; resolved question 1 |

## Decisions

| Decision | Reason |
|---|---|
| Rewind from the current issue | The only approach that gives every event the Local shape, list fields included, and replay then reproduces `getIssue`. |
| State names in `move` events, categories through `discover().statuses` | The metrics already work that way, and `discover()` applies `mappings.status`, so no metric code knows Linear. |
| Comments merged into the history as `comment` events | Local logs one per comment, and `stalled` and the standup digest count them. |
| Only the verified relation code | A guessed code could invert a blocker. PMK-39 extends the table from real writes. |
| `metricEvents` in this issue | The manifest already reports `native_metrics` as derived from history, and no other issue owns the operation (resolved question 2). |
| Newest updated issues first in `metricEvents` | A cut at 1000 issues keeps the issues the metrics weigh most. |
| A non-enumerable `truncated` flag on the arrays | The contract returns arrays, and `discover()` already carries hidden data the same way. |
| Client UUID on `commentCreate` | An unconfirmed create is checked with one read instead of risking a duplicate comment. |
| `ISSUE_FRAGMENT` untouched | PMK-37 and PMK-38 change it in parallel. |
| No marker added to bodies | The body is what the user confirmed, and no feature needs to recognize pmkit's comments (resolved question 3). |

## Risks

- **Relation codes.** Only `ar` is verified. Until PMK-39 adds the others, the history shows no `blocks` or `duplicate` changes and no removals, and `create` holds the current `blocked_by` and `duplicate_of` lists.
- **`updatedAt` and comments.** `metricEvents({ since })` filters issues by `updatedAt`. If a new comment does not move `updatedAt`, a comment on an otherwise quiet issue is missing from a `since` range. PMK-39 checks it; the fallback is an `or` with a comment date filter.
- **Mutations are unverified.** `commentCreate` with a client `id` and `parentId`, and `commentResolve` on a root and on a reply, come from introspection. PMK-39 confirms them.
- **Markdown round trip.** Linear regenerates `body` from its document, so a comment can read back with different Markdown than pmkit sent. PMK-39 records what changes.
- **History of an issue that moved teams.** Old entries name states of the old team. Their names may be missing from the scope team's statuses, and those moves map to `null`.
- **Cost of the flow metrics.** Each metrics command reads up to 1000 issues with their history and comments. On a large team that is several requests per run, and the 1-hour discovery cache does not help. A cache of metric events in the user store is a follow-up if PMK-39 shows the cost matters.
- **Contract change.** Adding `resolveThread` to `TRACKER_OPERATIONS` makes `assertTracker` fail for any test double that lacks it. The plan updates them in the same commit.
- **Local comment files become writable.** Resolving rewrites a root comment file, which can conflict in git (see "The Local tracker and threads").
- **The fake can drift from Linear.** The fake records history the way this spec assumes. The opt-in live read checks the mapping on real entries, and PMK-39 checks entries that writes produce.

## Resolved questions

1. **Where does resolving a thread live?** Answer: (a). Thread resolution is a contract operation, `resolveThread(id, commentId, actor)`, with `comment(..., { replyTo })`. The Local tracker implements it first, because Local is the reference (ADR-0001), then Linear. Every test double that lacks `resolveThread` is fixed in the same change.
2. **Does PMK-36 build `metricEvents` for Linear?** Answer: (a). Yes, in this issue, as designed above.
3. **Should pmkit mark the comments it writes?** Answer: (a). No marker. The body is exactly what the user confirmed.

## Left to the builder

- The split between `history.mjs` and `history-ops.mjs`, and the document names, as long as each document has a name and the fake routes by it.
- The wording of messages, next steps and warnings, as long as none names a secret or the real workspace.
- The CLI name `issues resolve`, if another fits the command table better.
- How the fake stores history and comments.

## Self-review

- Placeholders: none. Facts not verified live are in "Risks" with the issue that settles them.
- Consistency: "viewer" is the owner of `LINEAR_API_KEY`. "Entry" is one Linear history record and "event" one pmkit event. "Thread" is a root comment and its replies. Examples use `acme` and `ACME`.
- Scope: two adapter modules, six documents, five operations, one contract operation and its Local implementation, three CLI changes, a suite change and the fake. No schema change, no write to Linear, no ADR.
- Boundaries: cycles to PMK-37, projects and milestones to PMK-38, live writes and the relation codes to PMK-39, degraded paths to PMK-40, time tracking stays absent.
