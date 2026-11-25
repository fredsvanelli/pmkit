# PMK-77 Jira work items, transitions, links and JQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Jira tracker serves the Issues, Relations, History, Comments and Native search families, with transitions that ask for required screen fields and filters translated to JQL.

**Architecture:** Pure mapping modules under `scripts/lib/jira/` (ids, ADF, work-item model, JQL, transitions, changelog events, mapping check) are wired by three operation modules (`issue-ops`, `relation-ops`, `history-ops`) into `tracker.mjs`, which gains GitHub's discovery cache, memo and `guarded` mapping check. A stateful fake Jira (`scripts/fake-jira-issues.mjs`) backs the unit tests, the contract suite and the runbook E2E.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-77-jira-work-items-transitions-links-jql-design.md` (read it; every table there is normative). ADR 0013, ADR 0014, ADR 0015.

## Global Constraints

- No dependency; every Jira request goes through `createJiraClient` (`request`, `paginate`, `session`).
- No test opens a socket: tests inject `fakeJiraFetch`; tracker tests set `PMKIT_HOME` with `userStoreEnv()` from `scripts/test-helpers.mjs`.
- No `FAKE_TOKEN`, `FAKE_EMAIL` or `FAKE_HEADER` in any output, error or cache file.
- Every Local, Linear and GitHub golden stays byte-identical.
- Writes take `(…, actor, { dryRun })` and return `{ before, after }`; a dry run sends no `POST`, `PUT` or `DELETE`.
- The actor must be the viewer: else `INVALID_INPUT`, `Jira records every write as the owner of JIRA_API_TOKEN (<name>)`, next step `Drop --as, or use a token created by that member`.
- Not served here: `sprint`/`release` filter and `sprint`/`milestone`/`release` write values → `NOT_SUPPORTED` naming PMK-78 / PMK-79. `archive`, `unarchive` → `NOT_SUPPORTED`, `Jira archives work items only on Premium; archive it in Jira, and it leaves pmkit's searches`. `resolveThread` and `comment` with `replyTo` → `NOT_SUPPORTED`, `Jira comments have no threads`. `restore` → `NOT_SUPPORTED`, `Jira has no trash, so a deleted work item cannot come back`. `delegate` → `NOT_SUPPORTED` with the manifest's `agent_delegation` hint.
- Commit messages carry `(PMK-77)` and the Co-Authored-By line.

## Review Focus

1. A label, text or assignee holding `"` or `\` must not break or inject JQL → `filter.test.mjs` quotes `a"b\c` as `"a\"b\\c"` (Task 4).
2. A work item whose status the cached discovery lacks (renamed status) must read with a category, not crash → `issues.test.mjs` falls back to `statusCategory.key` (Task 3); `issue-ops.test.mjs` refreshes once (Task 8).
3. A move whose workflow has no direct transition must send nothing and name reachable statuses → `transitions.test.mjs` (Task 5) and `issue-ops.test.mjs` (Task 8).
4. A description with unsupported ADF nodes (table, panel) must keep its words on read → `adf.test.mjs` (Task 1).
5. A cached raw discovery from PMK-76 (no `members`) must be read again, not used → `tracker.test.mjs` (Task 8).

---

### Task 1: Ids and ADF

**Files:**
- Create: `scripts/lib/jira/ids.mjs`, `scripts/lib/jira/adf.mjs`
- Test: `scripts/lib/jira/ids.test.mjs`, `scripts/lib/jira/adf.test.mjs`

**Interfaces:**
- Produces: `isIssueKey(value: string): boolean`; `normalizeKey(value: string): string` (upper-case); `adfToText(doc: object|null): string`; `textToAdf(text: string): object` (`{ type: 'doc', version: 1, content }`).

- [ ] **Step 1: Write failing tests.** `isIssueKey`: true for `ENG-12`, `eng-12`, `A1_B-3`; false for `12`, `ENG-0`, `ENG-`, `-1`, `ENG 1`. `adfToText`: each node of the spec's "ADF" paragraph (paragraph with hardBreak, heading level 2 → `## x`, bulletList, orderedList, taskList DONE/TODO → `- [x]`/`- [ ]`, codeBlock fenced, blockquote, rule, mention and inlineCard as text); a `table` keeps its cell text; `null` → `''`. Round trip: `adfToText(textToAdf(t)) === t` for a text with a paragraph, `## Acceptance criteria`, two task items, a bullet list and a fenced block.
- [ ] **Step 2:** `node --test scripts/lib/jira/ids.test.mjs scripts/lib/jira/adf.test.mjs` → FAIL (modules missing).
- [ ] **Step 3:** Implement both modules (blocks join with `\n\n`; task items get `localId`s `t1`, `t2`…).
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat: add Jira keys and ADF conversion (PMK-77)`.

### Task 2: Discovery additions and the mapping check

**Files:**
- Modify: `scripts/lib/jira/discovery.mjs`, `scripts/fake-jira-api.mjs` (`jiraSiteRoutes` adds the three routes)
- Create: `scripts/lib/jira/mappings.mjs`
- Test: `scripts/lib/jira/discovery.test.mjs`, `scripts/lib/jira/mappings.test.mjs`

**Interfaces:**
- Produces: raw keys `members: [{ id, name }] | null`, `priorities: [{ id, name }] | null`, `linkTypes: [{ id, name, inward, outward }] | null`; view `members` = raw members (viewer first, added when absent), `priorities` unchanged (pmkit levels). `brokenJiraMappings(raw, pmkit): [{ key, value, problem }]`.
- Fake routes: `GET /rest/api/3/user/assignable/search` → `[{ accountId: 'acc-1', displayName: 'Test User', accountType: 'atlassian' }, { accountId: 'acc-2', displayName: 'Second User', accountType: 'atlassian' }, { accountId: 'app-1', displayName: 'Bot', accountType: 'app' }]`; `GET /rest/api/3/priority` → Highest(1), High(2), Medium(3), Low(4), Lowest(5); `GET /rest/api/3/issueLinkType` → Blocks(10000, `is blocked by`, `blocks`), Duplicate(10002, `is duplicated by`, `duplicates`), Relates(10003, `relates to`, `relates to`).

- [ ] **Step 1: Failing tests.** discover `members` deep-equals `[{ id: 'acc-1', name: 'Test User' }, { id: 'acc-2', name: 'Second User' }]`; a 403 on the assignable read gives `members: [viewer]` and a warning containing `assignable users`; 1000 users gives the warning `Jira has more assignable users than pmkit read`; `raw.linkTypes.map(t => t.name)` = `['Blocks', 'Duplicate', 'Relates']`. `brokenJiraMappings`: `mappings.status.in_review: Nope` → one entry with key `mappings.status.in_review`; `mappings.types.bug: Defect` → one; `mappings.fields.estimate: customfield_9` → one; a valid config → `[]`.
- [ ] **Step 2:** `node --test scripts/lib/jira/discovery.test.mjs scripts/lib/jira/mappings.test.mjs` → FAIL.
- [ ] **Step 3:** Implement: three `optional` reads in `fetchDiscovery` (`UNREAD` gains `assignable users`, `priorities`, `link types`); `members` keeps `accountType === 'atlassian'` only.
- [ ] **Step 4:** Same command → PASS; `node --test scripts/runbook-discover-jira.test.mjs scripts/lib/jira/*.test.mjs` → PASS.
- [ ] **Step 5:** Commit `feat: discover Jira members, priorities and link types (PMK-77)`.

### Task 3: The work-item model

**Files:**
- Create: `scripts/lib/jira/issues.mjs`
- Test: `scripts/lib/jira/issues.test.mjs`

**Interfaces:**
- Consumes: Task 1, Task 2's raw keys, `discoveryView`, `fieldRoles`, `parseDescription`/`buildDescription` (`scripts/lib/body-criteria.mjs`), `checkKeys`/`CREATE_KEYS`/`UPDATE_KEYS`.
- Produces: `makeContext(raw, pmkit, session) → { raw, view, viewer, space, categoryOf(name, key), typeOfId(id), workTypeOf(pmkitType), priorityOf(name), priorityIdOf(level), linkType(kind), fields: { estimate, criteria } }`; `ISSUE_FIELDS(context): string[]` (the read list in the spec plus `parent`, `subtasks`); `toIssue(item, context, { children = [] }) → Issue`; `toFields(patch, before, context, { create }) → { fields, after }` (throws the spec's `INVALID_INPUT`/`NOT_SUPPORTED`); `jiraTime('2026-11-22T10:00:00.000+0000') → '2026-11-22T10:00:00.000Z'`.

- [ ] **Step 1: Failing tests,** one per row of "The work-item model" and "Writes": link directions (`inwardIssue` on Blocks → `blockedBy`; `outwardIssue` → `blocks`; Relates both ways deduplicated; Duplicate `outwardIssue` → `duplicateOf`); priority read for `Highest`/`Blocker`/`Major`/`Trivial`/`P9` (unset); priority write `high` → `{ id: '2' }`; estimate hours `7200` → `2` and back; criteria in description vs a criteria field; `type` default `Task` then first standard; `labels: ['a b']` → `INVALID_INPUT`; `sprint: 'x'` → `NOT_SUPPORTED` naming PMK-78; `milestone`/`release` → PMK-79; `status: 'Gone'` category falls back to `statusCategory.key`; `branch` from `properties['pmkit.branch']`.
- [ ] **Step 2:** `node --test scripts/lib/jira/issues.test.mjs` → FAIL.
- [ ] **Step 3:** Implement. Priority read map: `{ highest|urgent|critical|blocker: urgent, high|major: high, medium: medium, low|lowest|minor|trivial: low }`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: map Jira work items to pmkit issues (PMK-77)`.

### Task 4: JQL translation

**Files:**
- Create: `scripts/lib/jira/filter.mjs`
- Test: `scripts/lib/jira/filter.test.mjs`

**Interfaces:**
- Consumes: `makeContext` (Task 3), `checkFilter`.
- Produces: `jqlString(value) → string` (`"` + escaped + `"`); `translateFilter(filter, context) → { empty: true } | { jql: string, clientSteps: string[], serverLimit: number|undefined }` with `clientSteps` among `text`, `blocked`, `updated`, `sort`.

- [ ] **Step 1: Failing tests,** one per row of the spec's translation table, e.g. `{}` → `project = "ENG" ORDER BY created ASC, key ASC`; `{ categories: ['done'] }` → `status in ("5")`; categories with no status → `{ empty: true }`; `{ assignee: 'me' }` → `assignee = "acc-1"`; `none` → `assignee is EMPTY`; two labels → two `labels = ` clauses; `updatedAfter: '2026-11-10T12:00:00Z'` → `updated >= "2026-11-09"` and `updated` step; `sprint` → `NOT_SUPPORTED`; `serverLimit` set only for no steps and sort `created`; quoting `a"b\c`.
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: translate issue filters to JQL (PMK-77)`.

### Task 5: Transitions and screen fields

**Files:**
- Create: `scripts/lib/jira/transitions.mjs`
- Test: `scripts/lib/jira/transitions.test.mjs`

**Interfaces:**
- Produces: `pickTarget({ item, category, status, context }) → { id, name }` (spec steps 2; errors as written); `pickTransition(transitions, target, item) → transition` (step 4 error names reachable statuses); `requiredFields(transition) → [{ id, name, type, allowed }]`; `fieldValues(required, transition, given: Record<string,string>) → fields object` (step 6 rules; missing → `INVALID_INPUT` with `details.requiredFields`).

- [ ] **Step 1: Failing tests:** mapped status wins over category order; `in_review` unmapped → `NOT_SUPPORTED` with `/pmkit:setup`; no transition → `INVALID_INPUT` naming `Done, In Progress`; Resolution required without default listed with `allowed: ['Done', "Won't Do"]`; a field with `hasDefaultValue: true` not listed; `resolution=Done` → `{ resolution: { id: '10000' } }`; unknown value → `INVALID_INPUT`; a `user` type → `NOT_SUPPORTED`; a value for a field the transition lacks → `INVALID_INPUT`.
- [ ] **Steps 2–4:** fail, implement, pass (`node --test scripts/lib/jira/transitions.test.mjs`).
- [ ] **Step 5:** Commit `feat: pick Jira transitions and their screen fields (PMK-77)`.

### Task 6: Changelog events and comments

**Files:**
- Create: `scripts/lib/jira/history.mjs`
- Test: `scripts/lib/jira/history.test.mjs`

**Interfaces:**
- Produces: `toEvents(item, histories, context) → Event[]` (sorted by `at`, the spec's History table); `toComment(node, key) → { id, issue, author, body, created }`.

- [ ] **Steps 1–4:** a test per History row (status → `move`, labels → `update`, assignee → `assign`, `Link` add/remove, unknown field → `jira:<fieldId>`), then implement. Command: `node --test scripts/lib/jira/history.test.mjs`.
- [ ] **Step 5:** Commit `feat: map the Jira changelog to pmkit events (PMK-77)`.

### Task 7: The stateful fake Jira

**Files:**
- Create: `scripts/fake-jira-issues.mjs`
- Test: `scripts/fake-jira-issues.test.mjs`

**Interfaces:**
- Consumes: `jiraSiteRoutes`, `fakeJiraFetch` (a function route receives the call; its `url` holds the query).
- Produces: `fakeJiraIssues({ state, requireResolution = true }) → { routes, state, writes() }`; `state` is plain JSON `{ next, items: { KEY: {...} }, links, comments, properties, changelog }`. Routes: every call in the spec's facts table. `search/jql` evaluates the JQL subset of Task 4 and answers 400 to anything else. The Done transition carries a required `resolution` field (allowed Done `10000`, Won't Do `10001`) when `requireResolution`; the transition POST answers 400 without it. `writes()` lists non-GET calls.

- [ ] **Step 1: Failing tests:** create → `ENG-1`, read back; JQL `labels = "x" AND assignee is EMPTY` filters; unknown JQL → 400; transition to Done without resolution → 400; with it → status Done and a changelog entry; issueLink create shows on both items' `issuelinks` in the documented directions; `state` survives `JSON.parse(JSON.stringify())`.
- [ ] **Steps 2–4:** fail, implement, pass (`node --test scripts/fake-jira-issues.test.mjs`).
- [ ] **Step 5:** Commit `test: add a stateful fake Jira for work items (PMK-77)`.

### Task 8: The tracker and the Issues family

**Files:**
- Create: `scripts/lib/jira/issue-ops.mjs`
- Modify: `scripts/lib/jira/tracker.mjs`, `scripts/lib/jira/manifest.mjs`
- Test: `scripts/lib/jira/issue-ops.test.mjs`, `scripts/lib/jira/tracker.test.mjs`, `scripts/lib/jira/manifest.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5, 7.
- Produces: `issueOperations({ client, config, getContext, now }) → { getIssue, searchIssues, createIssue, updateIssue, moveToCategory(id, category, actor, { status, fields, dryRun }), assign, delete, readItem(key) }`. `moveToCategory` dry run returns `{ before, after, requiredFields }`. Tracker: cache key `jira-<site>-<space>` lowercased, TTL 3600 s, `discover({ refresh })`, `guarded`, the refusals in Global Constraints. `SERVED` adds `estimation`, `multilevel_hierarchy`, `dependencies`, `native_metrics`.

- [ ] **Step 1: Failing tests:** each operation over the fake; search paging and `hasMore`; `blocked` client step; `text` substring step; create with `status` transitions after the create; a create whose transition fails → `UPSTREAM` naming the key; dry runs send no write (`writes()` empty); move with required Resolution: dry run lists it, real run without `fields` sends nothing and fails `INVALID_INPUT`, with `{ resolution: 'Done' }` moves; `--as` another member refused; broken mapping → `NOT_CONFIGURED` with `details.mappings`; a PMK-76-shaped cache entry is read again; `delete` refused with `CONFLICT` while blocked-by; `archive` → `NOT_SUPPORTED`; `updateIssue(id, { branch })` writes the `pmkit.branch` property once and the same name sends nothing; an epic's `children` come from one batched `parent in (...)` JQL per search page; manifest test: the four entries no longer absent.
- [ ] **Steps 2–4:** fail, implement, pass (`node --test scripts/lib/jira/*.test.mjs`).
- [ ] **Step 5:** Commit `feat: serve Jira issues, moves and search (PMK-77)`.

### Task 9: Relations

**Files:**
- Create: `scripts/lib/jira/relation-ops.mjs`; Modify: `scripts/lib/jira/tracker.mjs`
- Test: `scripts/lib/jira/relation-ops.test.mjs`

**Interfaces:**
- Consumes: `issueOperations` (`readItem`, `getIssue`), `makeContext().linkType(kind)`.
- Produces: `relationOperations({ client, ops, getContext }) → { link, unlink, setParent }` per the spec's Relations table; loop checks up to 10 levels.

- [ ] **Steps 1–4:** tests for each row, existing link no-op, self link, unknown kind, blocks loop `ENG-1 → ENG-2 → ENG-1`, parent loop, missing link type → `NOT_SUPPORTED`; implement; `node --test scripts/lib/jira/relation-ops.test.mjs` → PASS.
- [ ] **Step 5:** Commit `feat: link and parent Jira work items (PMK-77)`.

### Task 10: History, comments and metric events

**Files:**
- Create: `scripts/lib/jira/history-ops.mjs`; Modify: `scripts/lib/jira/tracker.mjs`
- Test: `scripts/lib/jira/history-ops.test.mjs`

**Interfaces:**
- Produces: `historyOperations({ client, ops, getContext, now }) → { getHistory(id, { since }), listComments, comment(id, body, actor, { dryRun, replyTo }), resolveThread, metricEvents({ since, until }) }`.

- [ ] **Steps 1–4:** tests: create/update/comment order; `since`; empty body `INVALID_INPUT`; `replyTo` `NOT_SUPPORTED`; `metricEvents` tags `issue`, filters `until`, sorted; implement; PASS.
- [ ] **Step 5:** Commit `feat: read Jira history and comments (PMK-77)`.

### Task 11: Contract suite

**Files:**
- Modify: `scripts/contract-suite.mjs` (`FAMILIES` gains `archive`; the archive steps of the issues test and the "archived issues drop out of search" test need `archive`), `scripts/lib/linear/contract.test.mjs`, `scripts/lib/github/contract.test.mjs` (list `archive`)
- Create: `scripts/lib/jira/contract.test.mjs`

- [ ] **Step 1:** Split the archive assertions of "creates, gets, updates, moves…" into its own test `archives an issue` with `['issues', 'archive']`.
- [ ] **Step 2:** Jira run with `families: ['discovery', 'issues', 'relations', 'history']`, `mappings.status` for all seven categories, `mappings.types: { feature: Story, bug: Bug }`, `requireResolution: false`, actor `acc-1`.
- [ ] **Step 3:** `node --test scripts/contract.test.mjs scripts/lib/*/contract.test.mjs` → PASS (Local runs every test; Jira skips with reasons).
- [ ] **Step 4:** Commit `test: run the contract suite against the fake Jira (PMK-77)`.

### Task 12: CLI `--field` and the move command

**Files:**
- Modify: `scripts/pmkit.mjs` (`issues move` flags gain `field`; repeated `--field id=value` → `fields` object, a value without `=` is `INVALID_INPUT`; dry-run text adds `needs: <name> (<id>: <allowed, …>)` per required field), `commands/issues/move.md` (new step after the dry run: ask for each `requiredFields` entry the user gave no value for, with `allowed` as options, then dry-run again with `--field`; `write_policy.confirm: none` does not skip it), `docs/superpowers/specs/` design-spec CLI table if `issues move` has a row (PMK-155 test)
- Test: `scripts/lib/jira/tracker.test.mjs` (CLI via `run`) or `scripts/cli-jira.test.mjs`

- [ ] **Steps 1–4:** test `issues move ENG-1 done --dry-run --json` returns `requiredFields`; `--field resolution=Done` moves; `--field bad` → exit 2 `INVALID_INPUT`; Local `issues move` output unchanged (goldens); implement; `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: pass required screen fields to issues move (PMK-77)`.

### Task 13: Runbook, E2E, docs

**Files:**
- Create: `docs/runbooks/issues-jira.md`, `scripts/runbook-issues-jira.test.mjs` (launcher as in `runbook-discover-jira.test.mjs`, with the fake state read from and written back to a JSON file beside the launcher after each run)
- Modify: `docs/runbooks/discover-jira.md` and its test (capabilities: the four served entries), `CHANGELOG.md` (one Unreleased entry), `README.md` if it lists Jira support

- [ ] **Step 1:** Write the runbook (steps in the spec's "Runbook and E2E test").
- [ ] **Step 2:** Write the E2E test walking every step and checking no credential in output; run → FAIL until the runbook's commands work, then PASS.
- [ ] **Step 3:** `npm test` and `npm run lint` → PASS.
- [ ] **Step 4:** Commit `docs: add the Jira issues runbook and its E2E test (PMK-77)`.
