# PMK-77 design: work items, transitions, links and JQL for Jira

Issue PMK-77, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Status: draft for the Interview step. Written on 2026-11-22 by a dispatched worker with no live user dialogue, from the issue, ADR 0003, ADR 0013, ADR 0014, the PMK-75 and PMK-76 specs, the PMK-35 (Linear) and PMK-87 (GitHub) specs, which solved the same issue for their trackers, and the code. Calls marked **(builder's call)** change no acceptance criterion; the owner can override any of them. Questions only the owner can answer are in "Open questions", each with a recommendation the rest of this spec assumes. No Jira credentials exist, so nothing here was checked against a live site.

## Problem

The Jira tracker answers `discover` and `capabilities` (PMK-76) and throws `NOT_SUPPORTED` for every other contract operation (`scripts/lib/jira/tracker.mjs`). No command can list, read, create, move, link or comment on a Jira work item.

Acceptance criteria:

1. The adapter implements the Issues, Relations, History, Comments and Native search operations.
2. A transition that requires screen fields asks before writing.
3. Issue filters translate to JQL.

Sources: Unified model, "Common status categories" ("transition with required fields (Jira)"); Jira tab, "Write policy" ("confirmation for transitions that require screen fields"); the contract families of the pmkit design spec.

Bound decisions (not reopened here):

- Jira Cloud only, `JIRA_EMAIL` and `JIRA_API_TOKEN` from the environment, every call through the PMK-75 client, `tracker.scope.site` and `tracker.scope.space` (ADR 0013).
- `mappings.fields.<role>` holds the Jira field id (ADR 0014). `mappings.status.<category>` names a Jira status. `mappings.types.<pmkit type>` names a work type, as `discoveryView` already reads it.
- PMK-76 deferred the discovery cache and the mapping check before each operation to this issue, "with the first operation that needs them".

## Facts from Atlassian's OpenAPI documents

From the REST v3 OpenAPI document PMK-76 used (`swagger-v3.v3.json`, 2026-11-22). Not checked against a live site; the live-check follow-up in EPC-14 covers them.

| Call | What it gives |
|---|---|
| `GET /rest/api/3/search/jql?jql&fields&expand&properties&nextPageToken&maxResults` | Token page: `issues`, `nextPageToken`, `isLast`. `maxResults` up to 100 with fields. Archived work items are not returned. |
| `GET /rest/api/3/issue/{key}?fields&properties` | One work item. 404 when missing or not visible. `fields.issuelinks` holds each link with `type { name, inward, outward }` and either `inwardIssue` or `outwardIssue` (key and `fields.status`). `fields.subtasks` lists subtasks. |
| `POST /rest/api/3/issue` | `{ fields }` → `{ id, key }`. Required create-screen fields Jira lacks answer 400. |
| `PUT /rest/api/3/issue/{key}` | `{ fields }` → 204. |
| `DELETE /rest/api/3/issue/{key}` | 204. 400 when it has subtasks and `deleteSubtasks` is not set. |
| `PUT /rest/api/3/issue/{key}/assignee` | `{ accountId }`, `null` unassigns. |
| `GET /rest/api/3/issue/{key}/transitions?expand=transitions.fields` | `transitions: [{ id, name, to: { id, name, statusCategory }, hasScreen, fields: { <fieldId>: { required, hasDefaultValue, name, schema, allowedValues } } }]`, the ones the current status and the user's permissions allow. |
| `POST /rest/api/3/issue/{key}/transitions` | `{ transition: { id }, fields }` → 204. 400 when a required screen field is missing. |
| `GET /rest/api/3/issue/{key}/changelog` | Offset page of `values: [{ id, author { accountId }, created, items: [{ field, fieldId, from, fromString, to, toString }] }]`. |
| `GET /rest/api/3/issue/{key}/comment?orderBy=created` | Offset page of `comments: [{ id, author, body (ADF), created }]`. Comments are flat. |
| `POST /rest/api/3/issue/{key}/comment` | `{ body: ADF }` → the comment. |
| `POST /rest/api/3/issueLink`, `DELETE /rest/api/3/issueLink/{id}` | Create with `{ type: { name }, inwardIssue: { key }, outwardIssue: { key } }`; delete by link id. |
| `GET /rest/api/3/issueLinkType` | `issueLinkTypes: [{ id, name, inward, outward }]`. Defaults: Blocks (blocks / is blocked by), Relates (relates to), Duplicate (duplicates / is duplicated by). |
| `GET /rest/api/3/priority` | Every priority, in the site's order: `{ id, name }`. Defaults: Highest, High, Medium, Low, Lowest. |
| `GET /rest/api/3/user/assignable/search?project=KEY` | An array of users (`accountId`, `displayName`, `accountType`), up to `maxResults`. |
| `PUT /rest/api/3/issue/{key}/properties/{propertyKey}` | Stores any JSON value on the work item. `GET issue` and `search/jql` return it with `properties=<key>`. |
| `PUT /rest/api/3/issue/archive`, `.../unarchive` | Premium and Enterprise only. Archived work items leave JQL search. |
| Descriptions, comments, text-area fields | Atlassian Document Format (ADF) JSON in v3, not text. |

Consequences: every description and comment goes through an ADF conversion; status changes are transitions the workflow may refuse or guard with a screen; JQL dates have minute precision in the user's time zone; search with `expand=changelog` returns each item's changelog inline.

## Goals

- `searchIssues`, `getIssue`, `createIssue`, `updateIssue`, `moveToCategory`, `assign`, `delete`, `link`, `unlink`, `setParent`, `getHistory`, `listComments`, `comment` and `metricEvents` work on Jira and return the common shapes, with `{ before, after }` for writes and `{ dryRun: true }` sending no write.
- `moveToCategory` runs the workflow transition to the target status. When that transition has required screen fields without a default, the dry run lists them and the real run refuses until the caller gives their values (criterion 2).
- `searchIssues` translates the contract filter to JQL and finishes on the client what JQL cannot say exactly (criterion 3).
- `discover` lists assignable users as `members`, the priorities and the link types; it reads through a cache in the user store; every operation but `discover` and `capabilities` stops on a broken mapping first.
- The manifest serves `estimation`, `multilevel_hierarchy`, `dependencies` and `native_metrics`.
- The contract suite runs its discovery, issues, relations and history tests against a stateful fake Jira in `npm test`, and a runbook with its E2E test covers the issue flows.

## Non-goals

- Sprints (PMK-78), epics as deliverables, versions and status updates (PMK-79), worklogs (PMK-80). `sprint`, `milestone` and `release` writes with a value and the `sprint` and `release` filters answer `NOT_SUPPORTED` naming the issue. `getDeliverable` and the rest stay stubs.
- `init --tracker jira` and the setup questions (PMK-365).
- Comment threads: Jira comments are flat. `comment` with `replyTo` and `resolveThread` answer `NOT_SUPPORTED`, `Jira comments have no threads`, as on GitHub.
- Delegation (`delegate`) and `restore`: Jira has neither an agent delegate nor a trash. Both answer `NOT_SUPPORTED`.
- Chaining transitions. A workflow with no direct transition to the target is refused with the statuses one step away; pmkit never runs several transitions for one move.
- A run of the contract suite against a live site (EPC-14 follow-up).

## Anti-goals

- `npm test` opening a socket; every test injects the fake `fetch`.
- A dependency (ADR 0003).
- A token, the email or the Basic header in any output, error, cache file or argument.
- A change to any Local, Linear or GitHub output. Every golden stays byte-identical.
- A transition sent with a required screen field pmkit guessed. A required field without a default is always the caller's value.
- A write sent twice. The client sends each write once.

## Approaches

### How the adapter is split

1. **GitHub-shaped modules (chosen).** Pure mapping modules (`issues.mjs` for the work-item model, `adf.mjs`, `filter.mjs` for JQL, `history.mjs` for changelog events) and operation modules (`issue-ops.mjs`, `relation-ops.mjs`, `history-ops.mjs`) wired by `tracker.mjs`, with the cache, memo and `guarded` mapping check copied from the GitHub tracker. PMK-78 to PMK-80 already expect this layout, and the pure modules are tested without a fake.
2. **One `tracker.mjs`.** Fewer files, but one file mixing JQL, ADF, transitions and changelog would pass 1500 lines, and the Linear and GitHub precedent is the split.
3. **A shared hosted-tracker core.** The three adapters share only the filter checks, the comparator, the criteria parser and the delete refusal, which are already shared modules. A wider core puts two working adapters at risk for no caller.

### How search works (criterion 3)

A. **JQL narrows, the client finishes (chosen).** Every key JQL expresses exactly becomes a clause; keys it cannot (substring text, `blocked`, exact update instants) become client steps over the page JQL returns, then the shared comparator sorts and the cut applies. Same order as the Local tracker, as on Linear and GitHub.
B. **JQL only.** Fewer bytes, but `text ~` is a stemmed word search, dates are minute-precision local times and `blocked: false` has no JQL, so results would differ from the Local tracker.
C. **Client only.** Exact, but reads every item of the space and does not translate filters to JQL, which criterion 3 asks for.

### How a required screen field asks (criterion 2)

i. **The dry run lists the fields, the caller gives values (chosen).** `moveToCategory` returns `requiredFields` in its dry run; the real run without a value for each refuses with `INVALID_INPUT` and the list in `details`; `issues move` gains a repeatable `--field <id>=<value>`; `commands/issues/move.md` asks the user for each value (with Jira's allowed values as choices) before the confirmation of the move. The question happens before any write, and the agent never invents a value.
ii. **Refuse, move it in Jira.** Smallest, but every Done transition with a Resolution screen sends the user to the browser, which is the most common move.
iii. **Fill defaults.** Pick the first allowed value. Writes a value nobody chose; rejected by the anti-goals.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/jira/ids.mjs` | New. `isIssueKey`, `normalizeKey` (`eng-12` → `ENG-12`). |
| `scripts/lib/jira/adf.mjs` | New, pure. `adfToText(doc)`, `textToAdf(text)`. |
| `scripts/lib/jira/issues.mjs` | New, pure. `makeContext(raw, pmkit, session)`, `toIssue(item, context)`, the priority rule, `issueFields(context)`, `toFields(patch, before, context)`. |
| `scripts/lib/jira/filter.mjs` | New, pure. `translateFilter(filter, context)` → `{ jql, clientSteps, serverLimit }` or `{ empty: true }`; `jqlString`. |
| `scripts/lib/jira/history.mjs` | New, pure. `toEvents(item, changelog, context)`, `toComment(node, key)`. |
| `scripts/lib/jira/transitions.mjs` | New, pure. `pickTarget`, `pickTransition`, `requiredFields`, `fieldValues(fields, given)`. |
| `scripts/lib/jira/issue-ops.mjs` | New. `searchIssues`, `getIssue`, `createIssue`, `updateIssue`, `moveToCategory`, `assign`, `delete`. |
| `scripts/lib/jira/relation-ops.mjs` | New. `link`, `unlink`, `setParent`. |
| `scripts/lib/jira/history-ops.mjs` | New. `getHistory`, `listComments`, `comment`, `resolveThread`, `metricEvents`. |
| `scripts/lib/jira/mappings.mjs` | New, pure. `brokenJiraMappings(raw, pmkit)`. |
| `scripts/lib/jira/discovery.mjs` | `fetchDiscovery` adds the assignable users, the priorities and the link types; `discoveryView` lists the users as `members`. |
| `scripts/lib/jira/tracker.mjs` | The cache and memo, `guarded`, the operations, the refusals. |
| `scripts/lib/jira/manifest.mjs` | `SERVED` gains `estimation`, `multilevel_hierarchy`, `dependencies`, `native_metrics`. |
| `scripts/pmkit.mjs` | `issues move` takes `--field <id>=<value>`, repeatable, passed as `fields`; its text output names the required fields of a dry run. |
| `commands/issues/move.md` | A step that asks for each required field before the confirmation. |
| `scripts/contract-suite.mjs` | An `archive` family split out of `issues` (see open question 1); Linear and GitHub list it. |
| `scripts/fake-jira-issues.mjs` | New. A stateful fake Jira for pmkit's calls, JSON state the E2E launcher saves between runs. |
| `scripts/lib/jira/*.test.mjs`, `scripts/lib/jira/contract.test.mjs` | Unit tests per module and the contract suite. |
| `docs/runbooks/issues-jira.md`, `scripts/runbook-issues-jira.test.mjs` | New. The issue flows on Jira and their E2E test. |
| `docs/runbooks/discover-jira.md`, its test | The capabilities step: the four served entries are no longer absent. |
| `CONTEXT.md`, `docs/adr/` | **Transition** and **Screen field**; an ADR if the owner keeps the branch property (open question 2). |

### Ids

A work item's pmkit id is its key, `ENG-12`. `isIssueKey` accepts `^[A-Za-z][A-Za-z0-9_]+-[1-9][0-9]*$`, and the adapter upper-cases it. Any other string fails with `NOT_FOUND`, `issue <id> does not exist`, before a request. A key of another space reads and links (Jira allows cross-space links); writes that create go to `tracker.scope.space` only. No `isEpicId`: epics are work items on Jira, so `issues dependencies` reads an epic key through `getIssue` until PMK-79 decides deliverables **(builder's call)**.

### Discovery additions, cache and mapping check

`fetchDiscovery` adds three reads, each optional with a warning (PMK-76's `optional`):

- `GET /rest/api/3/user/assignable/search?project=<space>&maxResults=1000` → `members`, `accountType: 'atlassian'` only, as `{ id: accountId, name: displayName }`; the viewer first when Jira leaves it out. 1000 returned gives the warning `Jira has more assignable users than pmkit read`.
- `GET /rest/api/3/priority` → `priorities: [{ id, name }]` in Jira's order.
- `GET /rest/api/3/issueLinkType` → `linkTypes: [{ id, name, inward, outward }]`.

`raw.version` stays 1; the cache check also requires `Array.isArray(raw.members)`, so a raw discovery from before this issue is read again.

The tracker keeps the raw discovery as GitHub's does: a memo per run, then the user store (`cacheGet`/`cachePut`, key `jira-<site>-<space>`, one hour), then Jira. `discover({ refresh: true })`, which `pmkit discover` and setup pass, reads Jira and rewrites the cache.

`brokenJiraMappings(raw, pmkit)` lists, as `{ key, value, problem }`: a `mappings.status.<category>` naming a status the space lacks; a `mappings.types.<type>` naming a work type the space lacks; a `mappings.fields.<role>` naming a field id the site lacks. Every operation but `discover` and `capabilities` runs through `guarded`: the mapping check, one refresh when the broken list came from the cache, then `NOT_CONFIGURED`, `a mapping in .pmkit/config.yaml names something Jira no longer has: ...`, next step `/pmkit:setup`, `details.mappings`.

### The work-item model

Every read asks for one field list: `summary, status, issuetype, priority, assignee, labels, parent, subtasks, issuelinks, duedate, description, created, updated, creator`, the estimate role's field and the acceptance-criteria role's field when set, and the property `pmkit.branch` (open question 2).

| pmkit field | From Jira |
|---|---|
| `id` | `key` |
| `title` | `summary` |
| `status` | `{ name: status.name, category }`, the category `discoveryView` gives that name; a status the discovery lacks refreshes once, then falls back to `status.statusCategory.key` |
| `type` | The pmkit type whose `mappings.types` value is `issuetype.name`; unset when none |
| `priority` | The priority rule below |
| `estimate` | The estimate role's field: the number for points; seconds / 3600 for `timeoriginalestimate` |
| `assignee` | `assignee.accountId` |
| `labels` | `labels`, sorted |
| `parent` | `parent.key` |
| `children` | `subtasks` keys, plus, for an epic-level item, the keys a JQL `parent = <key>` returns (one batched `parent in (...)` per search page that holds epics) |
| `blockedBy` | `issuelinks` of the blocks type with `inwardIssue` (the other item blocks this one) |
| `blocks` | the same type with `outwardIssue` |
| `related` | the relates type, both directions, without duplicates |
| `duplicateOf` | the duplicate type with `outwardIssue` (this item duplicates the other) |
| `archived` | `false` (open question 1) |
| `due` | `duedate` |
| `branch` | the `pmkit.branch` property (open question 2) |
| `description`, `acceptanceCriteria` | `adfToText(description)` through the shared `parseDescription`, or the criteria field when the role has one (below) |
| `created`, `updated` | ISO UTC with `Z`, from Jira's `+0000` offsets |
| `sprint`, `milestone`, `release` | Unset (PMK-78, PMK-79) |

Relation lists are sorted with `compareIds`. The link types are found by name in the discovered list: `Blocks`, `Relates`, `Duplicate`, compared without case **(builder's call)**. A link of a type not found reads as nothing; `link` of a kind whose type the site lacks answers `NOT_SUPPORTED`, `Jira at <site> has no <name> link type`.

**Priority rule (builder's call).** Read: `highest`, `urgent`, `critical`, `blocker` → `urgent`; `high`, `major` → `high`; `medium` → `medium`; `low`, `lowest`, `minor`, `trivial` → `low`, by name without case; any other name reads as unset and `discover` warns once. Write: the first discovered priority, in Jira's order, whose read is the pmkit priority; none gives `INVALID_INPUT` naming the site's priorities. `null` clears only when the priority field is not required; Jira answers 400 otherwise, which the client maps to `INVALID_INPUT` with Jira's message.

**ADF (builder's call).** `adfToText` reads `paragraph` (hard breaks as newlines), `heading` (`#` × level), `bulletList` and `orderedList` (`- ` and `1. `), `taskList` (`- [ ] ` and `- [x] `), `codeBlock` (fenced), `blockquote` (`> `), `rule` (`---`) and inline text, mentions and links as their text; any other node reads as the text of its children, so a read never drops words. Blocks join with a blank line. `textToAdf` writes the reverse for the same subset: `#` lines as headings, a run of `- [ ]` lines as a `taskList`, a run of `- ` lines as a `bulletList`, fenced code as `codeBlock`, every other run of lines as a paragraph with hard breaks. Criteria use the shared `## Acceptance criteria` section, so they round-trip as a heading and a Jira task list (native checkboxes). Formatting outside that subset (tables, panels, colors) is lost when pmkit rewrites the description; a read-modify-write of only the title or labels does not touch the description.

**Acceptance criteria field (builder's call).** When the `acceptance_criteria` role resolves to a field (PMK-76's rule finds a field named `Acceptance criteria`), the criteria are that field's task list and the description keeps none; else the section of the description, as on Linear and GitHub.

### Writes

Every check runs before any request; a dry run runs the same checks and returns `after` built by the same mapping. The actor is the viewer, the token's owner (ADR 0013): any other `actor` fails with `INVALID_INPUT`, `Jira records every write as the owner of JIRA_API_TOKEN (<name>)`, next step `Drop --as, or use a token created by that member`.

| Key | Create | Update | Jira |
|---|---|---|---|
| `title` | required | yes | `summary`, one line |
| `type` | yes; without it the first `standard` work type named `Task`, else the first `standard` one **(builder's call)** | yes, `null` refused (Jira needs a type) | `issuetype: { id }` of `mappings.types[type]` |
| `description`, `acceptanceCriteria` | yes | yes | `description` (and the criteria field) as ADF |
| `priority` | yes | yes, `null` clears | `priority: { id }` |
| `estimate` | yes | yes, `null` clears | the estimate field; hours become seconds. No estimate field: `NOT_SUPPORTED`, the manifest's hint |
| `labels` | yes | yes | `labels`; a label holding a space is `INVALID_INPUT` (Jira refuses it). Jira creates new labels, so no unknown-label check |
| `due` | yes | yes, `null` clears | `duedate` |
| `assignee` | yes | owned by `issues assign` | `assignee: { accountId }`, a discovered member; an unknown id refreshes once |
| `parent` | an issue key | owned by `issues parent` | `parent: { key }` |
| `status` | yes | owned by `issues move` | the transition below, after the create |
| `branch` | no | yes | the property (open question 2) |
| `sprint`, `milestone`, `release` | `null` only | `null` only | a value: `NOT_SUPPORTED` naming PMK-78 or PMK-79 |

`createIssue` posts the item, then the transition when `status` is set. A transition failure after the create fails with `UPSTREAM`, `Jira created <key>, but the move to <status> failed: ...`, next step `pmkit issues move <key> <category>`. A required create-screen field Jira wants comes back as Jira's 400 message (`INVALID_INPUT`). Jira has no client-chosen id, so an unconfirmed create keeps the client's error, whose next step says to check Jira first. `updateIssue` sends one `PUT` with only the changed fields, and nothing when nothing changes.

### `moveToCategory` and screen fields (criterion 2)

`moveToCategory(id, category, actor, { status, fields, dryRun })`:

1. Check `category`, read the item (`before`) and its transitions with `expand=transitions.fields`.
2. Target status: `status` when given, which must be a status of the item's work type in `category`; else `mappings.status[category]` when set and not `none`; else the first status of the work type, in Jira's order, whose category is `category`. None: `NOT_SUPPORTED`, `work type <name> in space <key> has no status in the <category> category`, next step `/pmkit:setup` (Jira has three categories, so `backlog`, `in_review`, `triage` and `canceled` need `mappings.status`).
3. Already in the target status: `{ before, after: before }`, nothing sent.
4. The transition whose `to.id` is the target. None: `INVALID_INPUT`, `Jira's workflow has no transition from <status> to <target> for <key>`, next step `Move it to one of: <the statuses the transitions reach>`.
5. Required fields: the transition's fields with `required: true` and `hasDefaultValue: false`, as `{ id, name, type, allowed: [names] }`. A dry run returns `{ before, after, requiredFields }` (`after` shows the target status), whether or not values were given, so the confirmation shows them. A real run with a field missing from `fields` sends nothing and fails with `INVALID_INPUT`, `the transition to <target> needs <names>`, next step `pmkit issues move <key> <category> --field <id>=<value>`, `details.requiredFields`.
6. Values: a field with `allowed` takes a name or id from that list, sent as `{ id }` (or `[{ id }]` for an array field); `number` a number; `date` `YYYY-MM-DD`; `string` the text (ADF for a text area); any other schema type: `NOT_SUPPORTED`, `pmkit cannot fill <name> (<type>); move <key> in Jira`. A value for a field the transition does not have is `INVALID_INPUT`.
7. `POST .../transitions` once, then read the item again for `after`.

`issues move` passes `--field id=value` (repeatable, split on the first `=`) as `fields`, and prints `needs: Resolution (resolution: Fixed, Won't Do)` in a dry run's text. `commands/issues/move.md` gains a step after the dry run: when `requiredFields` is not empty and the user gave no value for one, ask for each value with `AskUserQuestion` (the `allowed` names as options), then run the dry run again with `--field` and confirm the move as before. `write_policy.confirm: none` never skips that question, because it is input, not a confirmation.

### `assign` and `delete`

`assign(id, who, actor)` takes an account id, `me` or `null`, and sends `PUT .../assignee`, nothing when unchanged. `delete(id, actor)` refuses with the shared `referencedError` while another item references it: blocked by it, related, duplicate of it, or a child of it (subtasks and the JQL children). Then `DELETE /rest/api/3/issue/<key>`. Jira refuses without the Delete permission; the client maps that to `AUTH`.

### Relations

| pmkit | Jira |
|---|---|
| `link(a, b, 'blocks')` | `POST issueLink { type: Blocks, inwardIssue: a, outwardIssue: b }`, so `a.blocks` holds `b` |
| `link(a, b, 'related')` | the same with Relates |
| `link(a, b, 'duplicate')` | the same with Duplicate, so `a.duplicateOf` holds `b` |
| `unlink(a, b, kind)` | `DELETE issueLink/<id>` for each link of that type from `a` to `b` in `a`'s `issuelinks` (either direction for related) |
| `setParent(id, parent)` | `PUT issue { fields: { parent: { key } } }`; `null` sends `parent: null` |

Both items are read first; an existing link or an empty unlink sends nothing and returns `{ before, after: before }`. Self links, unknown kinds and loops (blocks and parent, read up to 10 levels as on Linear and GitHub) fail with `INVALID_INPUT`. The result is `a` before and after. The direction of `inwardIssue` and `outwardIssue` on create is the most-cited reading of Atlassian's example and is unverified; the live follow-up checks it, and only `relation-ops.mjs` changes if it is the other way.

### Search: Native search (criterion 3)

`searchIssues(filter)` checks the filter with the shared `checkFilter` (`types` from `discover().types`, `members` from the discovered members), then `translateFilter`:

| pmkit key | JQL | Client step |
|---|---|---|
| (scope) | `project = "ENG"` | |
| `text` | `(summary ~ "t" OR description ~ "t")` | Keep a case-free substring match of title or description, as Local |
| `categories` | `status in (<ids of the statuses in those categories>)` | Empty id list: `[]` with no request |
| `types` | `issuetype in (<ids of the mapped work types>)` | |
| `assignee` | `assignee = "<accountId>"`, the viewer for `me`; `none`: `assignee is EMPTY` | |
| `labels` | `labels = "x"` per label | |
| `parent` | `parent = "ENG-1"` | |
| `blocked` | none | `true`: keep items with a blocker whose category is not terminal (the blocker's status comes inline in `issuelinks`); `false`: drop them |
| `updatedAfter`, `updatedBefore` | `updated >= "<date − 1 day>"`, `updated < "<date + 1 day>"` (`yyyy-MM-dd`) | The exact instant compare, because JQL dates are minutes in the user's time zone |
| `archived` | none (open question 1) | |
| `sort` | `ORDER BY created ASC, key ASC` | The shared comparator |
| `limit` | `limit` of `paginate` when no client step applies and the sort is `created` | Otherwise cut after sorting |
| `sprint`, `release` | | `NOT_SUPPORTED` (PMK-78, PMK-79) |

Clauses join with `AND`. `jqlString` quotes every value and escapes `\` and `"`, so no user text becomes JQL syntax. The read pages `search/jql` 100 at a time through the client's `paginate` (10 pages, 1000 items without a limit); the result is `{ issues, problems: [], hasMore }`, and `issues list` already warns on `hasMore`.

### History and comments

`getHistory(id, { since })` reads the changelog (offset pages) and the comments, and maps them to `{ at, by, op, field, from, to }`:

| Source | Event |
|---|---|
| the item | `create` at `created`, by `creator.accountId` |
| `status` | `move`, field `status`, the status names |
| `summary`, `description`, `labels`, `duedate`, `priority`, `issuetype`, the estimate field | `update`, field `title`, `description`, `labels`, `due`, `priority` (pmkit level), `type` (pmkit type, else the name), `estimate` |
| `assignee` | `assign`, account ids |
| `Link` | `link` or `unlink` (by which of `to` and `from` is set), field `links`, the other key |
| `IssueParentAssociation`, `Parent` | `update`, field `parent` |
| a comment | `comment` |
| any other field | `update`, field `jira:<fieldId>` **(builder's call)** |

Events sort by `at`; `since` drops the earlier ones. `listComments(id)` gives `{ id, issue, author, body, created }` with `body` from ADF. `comment(id, body, actor)` refuses an empty body and posts `textToAdf(body)`. `metricEvents({ since, until })` reads `project = "<space>" AND updated >= "<since − 1 day>" ORDER BY updated DESC` with `expand=changelog`, completes a changelog Jira cut with the per-item call, maps create and changelog events (no comments, which no metric reads **(builder's call)**), filters by `since` and `until`, tags `issue` and sorts by `at`; the 1000-item cap gives a warning.

### Capabilities

`SERVED` gains `estimation`, `multilevel_hierarchy`, `dependencies` and `native_metrics`, which then report the site's answer. Their `SERVED_IN` entries go. A test checks that every capability PMK-77 serves has its operations implemented.

### The stateful fake

`fakeJiraIssues(options)` keeps work items, links, comments, changelogs, properties and the workflow in memory and answers the calls above by `<METHOD> <path>`, on top of `jiraSiteRoutes`. It evaluates the JQL subset `translateFilter` emits (`AND` of the clauses in the table, `ORDER BY`), and answers any other JQL with 400, so a translator change the fake does not know fails the test. Its workflow lets every status reach every other, except a configured transition with a required `resolution` field, which answers 400 when the field is missing. It records every call, so tests assert that a dry run sent no write. Its state is plain JSON for the E2E launcher. The fake follows the documents above, not Jira.

### Contract suite

`scripts/lib/jira/contract.test.mjs` runs `runTrackerContract` with `families: ['discovery', 'issues', 'relations', 'history']` over the fake, with `mappings.status` naming a status for every category and `mappings.types` for `feature` and `bug`, and `actor` the fake viewer. `threads`, `time`, `cycles` and the rest are skipped with their reason.

### Runbook and E2E test

`docs/runbooks/issues-jira.md` walks: create a work item with a type and criteria, list it with a JQL-backed filter, move it to in progress, move it to done through a transition that needs Resolution (the dry run lists it, the real run without `--field` is refused, the run with `--field resolution=Done` moves it), link a blocker and see `blocked`, set a parent, comment, read the history, record the branch with `issues branch`, delete. `scripts/runbook-issues-jira.test.mjs` runs each step with the real CLI through the PMK-76 launcher, with the fake's state saved to a file between runs, and checks that no output carries the token, the email or the header.

### Live checks

Skipped: no credentials. A follow-up in EPC-14 lists them: the link direction on create, `parent: null`, the ADF task list in descriptions, `text ~`, the assignable-users read, the changelog in search, the property read in `search/jql`, and one move through a Resolution screen.

## Open questions

1. **Archive.** Jira archives only on Premium and Enterprise, and an archived item leaves JQL, so pmkit could never list it with `--archived`. Recommended: `archive` and `unarchive` answer `NOT_SUPPORTED`, `Jira archives work items only on Premium; archive it in Jira, and it leaves pmkit's searches`; the contract suite splits an `archive` family out of `issues`, which Local, Linear and GitHub list. Alternative: call Jira's archive API and accept that `--archived` never shows the item.
2. **Where the branch lives.** Jira has no branch field; `pr open` needs `issue.branch`. Recommended: a work-item property `pmkit.branch` (Jira's documented store for app data, read in the same request, invisible in the Jira UI), recorded as an ADR because it is a stored format. Alternative: no record, and `issues branch` on Jira answers `NOT_SUPPORTED` for the record, which breaks `/pmkit:issues:work` on Jira.
3. **Required screen fields.** Recommended: approach i (the dry run lists them, `--field`, the command asks). Alternative: approach ii, refuse and send the user to Jira.
4. **Branch name case.** pmkit names branches `eng-12-slug`. Jira's development panel matches the key in the branch name; whether it matches a lower-case key is unverified. Recommended: keep pmkit's name now and check it live in EPC-14. Alternative: keep the key upper case (`ENG-12-slug`) on Jira through a `settings()` flag.

## Acceptance criteria map

| Criterion | Design part | Tests |
|---|---|---|
| 1. Issues, Relations, History, Comments and Native search | "The work-item model", "Writes", "`assign` and `delete`", "Relations", "History and comments", "Search" | Unit tests per pure module; `issue-ops`, `relation-ops`, `history-ops` against the fake; the contract suite's four families; the runbook E2E |
| 2. A transition that requires screen fields asks before writing | "`moveToCategory` and screen fields", the `move.md` step | `transitions.test.mjs` for each rule; a tracker test where the dry run lists Resolution and the real run sends nothing without it; the CLI `--field` test; the runbook step |
| 3. Issue filters translate to JQL | "Search" | `filter.test.mjs`: every row, quoting, the empty list, `me`, the date widening; the fake rejects JQL it does not know |

## Risks

- Nothing is verified live; "Live checks" lists what the follow-up settles.
- ADF rewrite loses formatting outside the subset when pmkit writes a description.
- Workflows with conditions or validators beyond screen fields fail with Jira's 400 message, after the confirmation.
- `text ~` is a word search, so a substring JQL does not match (such as `rop` in `drop`) is missed; the client step only narrows further.
- The fake can drift from Jira.

## Left to the builder

- The layout inside each module, message wording within the templates above, the fake's option shape.
