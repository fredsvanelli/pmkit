# PMK-76 design: discover a Jira site and build its capability manifest

Issue PMK-76, epic EPC-7 (Jira tracker adapter and Bitbucket git host), milestone `jira`. Status: draft, waiting for the owner's approval. Written on 2026-11-22 by a dispatched worker with no live user dialogue, from the issue, ADR 0003, ADR 0013, the PMK-74 and PMK-75 specs, the PMK-33 (Linear discovery) and PMK-86 (GitHub discovery) specs and the code. Calls marked **(builder's call)** were made while writing this spec and change no acceptance criterion. No Jira credentials exist, so nothing here was checked against a live site.

## Problem

`tracker.system: jira` fails with `NOT_SUPPORTED`: `adapterFor('jira')` is `null` in `scripts/lib/adapters.mjs`. PMK-75 added the REST client (`scripts/lib/jira/client.mjs`) and its fake `fetch` (`scripts/fake-jira-api.mjs`), but nothing reads a site yet. Before PMK-77 to PMK-80 can read and write work items, sprints, epics and worklogs, pmkit must know which space a repository uses, its work types, its statuses and their categories, which Jira field holds each pmkit field role, and what the site's plan and settings allow.

Sources: the issue (Jira tab: Fields and metadata, Workflows and statuses; Unified model: Field roles, "the estimate role points to `customfield_10016`", and Capabilities, Jira column). The planning doc is not in the repository, so this spec works from the issue's quotes and Atlassian's published OpenAPI documents (REST v3 and Agile 1.0, downloaded on 2026-11-22 from developer.atlassian.com).

Acceptance criteria:

1. `discover` returns spaces, work types, statuses with categories and the field for each role.
2. Handles company-managed and team-managed spaces.
3. `capabilities` reports the paths the plan allows.

Bound by ADR 0013 (not reopened here):

- Jira Cloud only; the PMK-75 client runs the `serverInfo` and `myself` check, so a Server or Data Center site fails with `NOT_SUPPORTED` before any discovery call.
- `discover --json` returns `auth: { source, viewer, site }` first.
- PMK-76 adds `tracker.scope.site` and `tracker.scope.space` to the schema and the loader, required when `tracker.system` is `jira`.
- Discovery reads one space's style, statuses, work types and fields, so both styles map through the existing mapping shape.
- Every Jira call goes through the PMK-75 client; nothing else reads `JIRA_EMAIL` or `JIRA_API_TOKEN`.

## Facts from Atlassian's OpenAPI documents

Checked on 2026-11-22 in `swagger-v3.v3.json` (REST v3) and `swagger.v3.json` (Agile 1.0). Not checked against a live site.

| Call | What it gives | Permission |
|---|---|---|
| `GET /rest/api/3/project/search` | Offset page of `values` (`isLast`, `total`). Each `Project` has `id`, `key`, `name`, `projectTypeKey` (`software`, `service_desk`, `business`, `product_discovery`), `style` (`classic` or `next-gen`) and `simplified`. | Browse, per space |
| `GET /rest/api/3/project/{key}` | One `Project`, with `issueTypes` by default: `id`, `name`, `subtask`, `hierarchyLevel`, and `scope` (`{ type: 'PROJECT', project: { id } }` for a team-managed space's own types). | Browse |
| `GET /rest/api/3/project/{key}/statuses` | An array per work type: `{ id, name, subtask, statuses: [{ id, name, statusCategory: { key, name } }] }`. | Browse |
| `GET /rest/api/3/field` | Every field the user can see, as an array: `id`, `key`, `name`, `custom`, `schema: { type, system, custom, customId }`, `scope` (a team-managed space's own fields). Time tracking and subtask fields only when the global setting is on. | Jira access |
| `GET /rest/api/3/label` | Offset page of label strings in `values`, up to 1000 per page. | Jira access |
| `GET /rest/api/3/instance/license` | `applications: [{ id, plan }]`, `plan` one of `UNLICENSED`, `FREE`, `PAID`. | None |
| `GET /rest/api/3/configuration` | `issueLinkingEnabled`, `subTasksEnabled`, `timeTrackingEnabled` (deprecated), `timeTrackingConfiguration` (present when time tracking is on). | Jira access |
| `GET /rest/agile/1.0/board?projectKeyOrId=KEY` | Offset page of boards in `values`: `id`, `name`, `type` (`scrum`, `kanban`, `simple`). | Board view |
| `GET /rest/agile/1.0/board/{id}/configuration` | `estimation: { type, field: { fieldId, displayName } }`. | Board view |

Status categories carry `key` `new`, `indeterminate` or `done` (and `undefined` for "No category"). The license names `jira-software`, so it tells a site with Jira Software from one with only Jira Work Management, but it does not tell Standard from Premium.

## Goals

- A `jira` adapter in `ADAPTERS` whose `discover` and `capabilities` read one site and one space through the PMK-75 client.
- `discover` returns the `auth` block, the spaces, the configured space with its style, its work types with their statuses, the statuses with their categories, the field for each field role, and the common keys every command reads (`statuses`, `types`, `priorities`, `labels`, `members`, `estimate`, `viewer`, `warnings`).
- A company-managed space and a team-managed space give the same result shape; only `style` and the source of a few fields differ.
- `capabilities` returns the 20 entries, with the path the site's license, the space and the global settings allow.
- `tracker.scope.site` and `tracker.scope.space` checked by the adapter's `configProblems`, and named in the schema.
- `discover` and `capabilities` text output for a Jira site.
- A runbook, `docs/runbooks/discover-jira.md`, and its E2E test, run by `npm test` against the fake `fetch`.

## Non-goals

- `init --tracker jira` and a Jira section in `commands/setup.md` (see open question 1).
- Work items, transitions, JQL, assignable users, priority names (PMK-77); sprints (PMK-78); epics, versions and status updates (PMK-79); worklogs (PMK-80). Every contract operation but `discover` and `capabilities` stays a `NOT_SUPPORTED` stub.
- A discovery cache in the user store and the mapping check before each operation. `discover` always reads Jira, and no other operation reads discovery yet; PMK-77 adds both with the first operation that needs them, as PMK-87 did for GitHub **(builder's call)**.
- Telling Standard from Premium. No documented call says it.

## Anti-goals

- A request to any host but `tracker.scope.site`, or a token in any output (PMK-75 already guarantees both; the E2E test checks the CLI output).
- A capability entry whose path claims a command works while the operation behind it is a stub.
- A failed optional read (boards, configuration, license, labels) that sinks the whole `discover`.

## Approaches

1. **One discovery module plus a manifest module, Linear-shaped.** `jira/discovery.mjs` reads the raw data (`fetchDiscovery`) and builds the view (`discoveryView`); `jira/manifest.mjs` builds the entries; `jira/tracker.mjs` wires them with stubs; `jira/adapter.mjs` is the descriptor. Same split as Linear (PMK-33) and GitHub (PMK-86), which later issues already know how to extend. About 400 lines with tests.
2. **Everything in `jira/tracker.mjs`.** Fewer files, but PMK-77 to PMK-80 would each grow one file that mixes discovery, the manifest and the operations, and the Linear and GitHub precedent is the split.
3. **A shared discovery core across Linear, GitHub and Jira.** Their raw data share nothing but the common view keys, which are a few lines each; the refactor puts two working adapters at risk for no caller.

Chosen: approach 1 **(builder's call; the owner can override)**.

## Design

### Files

| File | Change |
|---|---|
| `scripts/lib/jira/discovery.mjs` | New. `fetchDiscovery(client, { space, now })`, `discoveryView(raw, pmkit, { session })`, `categoryOfStatus`, the field-role rules. |
| `scripts/lib/jira/manifest.mjs` | New. `buildJiraCapabilities(raw, pmkit)`. |
| `scripts/lib/jira/tracker.mjs` | New. `createJiraTracker(config, { env, now, fetch })`: `discover`, `capabilities`, a stub for every other operation. |
| `scripts/lib/jira/adapter.mjs` | New. `jiraDescriptor({ fetch })` and `jiraConfigProblems(pmkit)`. |
| `scripts/lib/jira/client.mjs` | Exports `HOST` so the config check and the client share one host rule. |
| `scripts/lib/adapters.mjs` | Registers `jira`. |
| `scripts/pmkit.mjs` | Jira lines in the `discover` and `capabilities` text output. |
| `scripts/fake-jira-api.mjs` | `JIRA_SITE_ROUTES`: the discovery routes of a company-managed space and a team-managed space, for the unit and E2E tests. |
| `schemas/pmkit.config.schema.json` | Descriptions name `site` and `space` for Jira. |
| `docs/runbooks/discover-jira.md`, `scripts/runbook-discover-jira.test.mjs` | New. The runbook and its E2E test. |
| `scripts/adapters.test.mjs`, `scripts/config.test.mjs`, `scripts/cli-hosted.test.mjs` | Their "unsupported tracker" example moves from `jira` to `gitlab`. |

### Config

`jiraConfigProblems(pmkit)`, the descriptor's `configProblems`, as GitHub's does:

- `tracker.scope.site` missing: `tracker.scope.site is required for jira`; not a bare host (the client's `HOST` rule, lowercased): `tracker.scope.site must be a host such as acme.atlassian.net`.
- `tracker.scope.space` missing: `tracker.scope.space is required for jira`; not a space key (`^[A-Z][A-Z0-9_]+$`): `tracker.scope.space must be a space key such as ENG`.

The loader already runs `configProblems` on a valid shape, so `pmkit validate` lists them and writes are refused. No new mapping rule: a `mappings.fields.<role>` that names a field the site does not have is a `discover` warning, as on GitHub (PMK-86) **(builder's call)**.

### Discovery: the raw data

`fetchDiscovery(client, { space, now })` calls `client.session()` first (the Cloud check), then reads in parallel:

1. Spaces: `paginate('/rest/api/3/project/search', { key: 'values' })` (10 pages of 50 at most; `hasMore` gives a warning).
2. The space: `request('GET', '/rest/api/3/project/<space>')`. A `NOT_FOUND` becomes `NOT_CONFIGURED`, `tracker.scope.space names <space>, which <site> does not have or the token's owner cannot browse`, next step `/pmkit:setup` **(builder's call)**.
3. Statuses: `request('GET', '/rest/api/3/project/<space>/statuses')`.
4. Fields: `request('GET', '/rest/api/3/field')`.
5. Labels: `paginate('/rest/api/3/label', { key: 'values', pageSize: 100 })`.
6. License: `request('GET', '/rest/api/3/instance/license')`.
7. Global settings: `request('GET', '/rest/api/3/configuration')`.
8. Boards, only when the space's `projectTypeKey` is `software`: `paginate('/rest/agile/1.0/board', { query: { projectKeyOrId: space }, key: 'values' })`, then the configuration of the first `scrum` board, else the first board.

Reads 5 to 8 are optional: an `AUTH`, `NOT_FOUND` or `UPSTREAM` failure gives `null` and a warning that names what is missing (as Linear's `tolerant`); `RATE_LIMITED` and any other code propagate. Reads 1 to 4 are required.

The raw data keeps only what the view and the manifest read:

```js
{
  version: 1,
  discoveredAt,
  spaces: [{ id, key, name, style: 'company-managed' | 'team-managed', type }],  // type is projectTypeKey
  space: { id, key, name, style, type },
  workTypes: [{ id, name, level, statuses: [statusId] }],   // level: 'subtask' (-1), 'standard' (0), 'epic' (1), or the number above
  statuses: [{ id, name, categoryKey }],                     // every status of the space, once
  fields: [{ id, name, custom, system, customType }],        // site fields plus this space's own, none of another space
  labels: [name] | null,
  license: { software: 'paid' | 'free' | 'unlicensed' | null },   // jira-software's plan, null when unread
  settings: { issueLinking, subTasks, timeTracking } | null,
  board: { id, type, estimationField: fieldId | null } | null,
  truncated: ['spaces' | 'labels'],
}
```

**Both space styles.** `style` reads `classic` as `company-managed` and `next-gen` (or `simplified: true`) as `team-managed`. A team-managed space's own work types and fields carry `scope.project.id`; the raw data keeps a scoped item only when that id is the space's, so another team-managed space's "Story point estimate" never shows up. Statuses come from the same call for both styles. Nothing else branches on the style **(builder's call)**.

### Discovery: the view

`discoveryView(raw, pmkit, { session })` returns, `auth` first as ADR 0013 asks:

```js
{
  auth: { source: 'JIRA_API_TOKEN', viewer: { accountId, displayName }, site },
  site: 'acme.atlassian.net',
  plan: { software: 'paid' },
  space: { key: 'ENG', name: 'Engineering', style: 'company-managed', type: 'software' },
  spaces: [{ key, name, style, type }],
  workTypes: [{ name: 'Story', level: 'standard', statuses: ['To Do', 'In Progress', 'Done'] }],
  statuses: [{ name: 'To Do', category: 'todo' }, ...],
  fields: { estimate: { id: 'customfield_10016', name: 'Story point estimate' } | null, priority: {...} | null, ... },  // every FIELD_ROLES key
  types: ['feature', 'bug'],                // the pmkit types mappings.types names, as on Linear
  priorities: ['urgent', 'high', 'medium', 'low'],
  labels: [...],
  members: [{ id: accountId, name: displayName }],   // the viewer only; PMK-77 reads assignable users
  viewer: { id: accountId, name: displayName },      // requireMember writes as the token's owner (ADR 0013)
  estimate: { unit: 'points' | 'hours', scale: [] },
  discoveredAt,
  warnings: [...],
}
```

**Statuses and categories.** Each status of the space, in the order Jira lists them, once. Its category is the one `mappings.status` gives its name (`blocked` excluded, as on Linear), else the status category: `new` is `todo`, `indeterminate` is `in_progress`, `done` is `done`. Any other key counts as `in_progress` with a warning. Jira has only three categories, so `backlog`, `in_review` and `canceled` come only from `mappings.status`; a mapping that names a status the space does not have is a warning.

**The field for each role.** For each of `FIELD_ROLES`, in order: the field `mappings.fields.<role>` names by id, when the site has it (a warning when it does not, then the rules); `none` gives `null`; else the first rule that matches **(builder's call; the rules are unverified on a live site)**:

| Role | Rule |
|---|---|
| `estimate` | The board's estimation field; else the field of custom type `com.pyxis.greenhopper.jira:jsw-story-points`; else a field named `Story point estimate` or `Story Points` |
| `priority` | System field `priority` |
| `target_date` | System field `duedate` |
| `start_date` | A field named `Start date` |
| `assignee` | System field `assignee` |
| `acceptance_criteria` | A field named `Acceptance criteria`; else `null` (the description holds them) |
| `time_spent` | System field `timespent` (Jira lists it only when time tracking is on) |
| `sprint` | The field of custom type `com.pyxis.greenhopper.jira:gh-sprint` |

Names match case-insensitively. `estimate.unit` is `hours` when the estimate field is `timeoriginalestimate`, else `points`; the scale is empty because Jira points take any number.

### The manifest

`buildJiraCapabilities(raw, pmkit)` returns the 20 entries in `CAPABILITIES` order. Each entry first gets the site's answer, the Jira column below. Then the served rule, as Linear's manifest does for an offer pmkit does not serve: while the Jira adapter implements no operation behind a capability, the entry is `absent`, keeps the site's answer in `detail.site` (and its other detail keys), and carries the hint `The Jira adapter does not serve <id> yet (<issue>)` **(open question 2)**. `linked_code` is served now (git, as on every tracker).

| Capability | Site answer | Served by |
|---|---|---|
| `cycles` | `native` when the license has Jira Software (not `unlicensed`) and the space has a `scrum` board; else `absent`, hint `Sprints need a Scrum board in space <key>` or `Sprints need Jira Software` | PMK-78 |
| `estimation` | `native` with `{ unit, field }` when the estimate role has a field; else `absent`, hint `No estimate field in space <key>` | PMK-77 |
| `multilevel_hierarchy` | `native` with `{ levels }` (the levels the work types have) when an epic or subtask level exists; else `absent` | PMK-77 |
| `dependencies` | `native` when `issueLinking` is on; `absent`, hint `Turn on issue linking in Jira's global settings`; `native` with a warning when settings are unread | PMK-77 |
| `native_triage` | `absent`, hint `Jira has no triage; map a status to triage in .pmkit/config.yaml` | none |
| `deliverables` | `native` with `{ entity: 'epic' }` when an epic-level work type exists; else `absent` | PMK-79 |
| `strategic_goals` | `absent`, hint `Jira goals live in Atlassian Home, which pmkit does not read` | none |
| `status_update` | `absent`, served hint only | PMK-79 |
| `releases` | `native` with `{ entity: 'version' }` | PMK-79 |
| `capacity` | `derived` with the local capacity file when `cycles` is `native`; else `absent`, hint `Capacity needs cycles` | PMK-78 |
| `native_metrics` | `derived` with `{ source: 'history' }` (the changelog) | PMK-77 |
| `saved_views` | `native` with `{ source: 'filters' }` | none in EPC-7 |
| `documents` | `absent`, hint `Jira has no documents` | none |
| `demand_signals` | `absent`, served hint only | none (PMK-83 is its own command) |
| `request_queue` | `absent`, served hint only | none |
| `time_tracking` | `native` when `timeTracking` is on; else `absent`, hint `Turn on time tracking in Jira's global settings` | PMK-80 |
| `linked_code` | `derived` with `{ source: 'git' }`, plus `Set git_host in .pmkit/config.yaml` when the git host is `none` | served now |
| `agent_delegation` | `absent`, served hint only | none |
| `security_alerts` | `absent`, served hint only | none |
| `user_inbox` | `absent`, served hint only | none |

"Served by" lives in one map in `manifest.mjs`, `SERVED`, empty but for `linked_code`; PMK-77 to PMK-80 add their capability when they implement it. "The plan" in criterion 3 reads as what the license, the space and the global settings allow, because Jira's API names no plan but `FREE` or `PAID` per product **(builder's call)**.

The manifest object: `{ tracker: 'jira', gitHost, generatedAt, discoveredAt, site, space, plan, capabilities, warnings }`.

### The tracker

`createJiraTracker(config, { env, now, fetch })` creates the client with the `tracker` block (so a missing variable or a secret-like key fails before any request), memoizes one discovery per run, and returns `discover({ refresh })`, `capabilities()` and a stub for every other contract operation: `NOT_SUPPORTED`, `the Jira adapter does not implement <operation> yet`, next step `Set tracker.system to local in .pmkit/config.yaml to use this command now`, as GitHub's stubs did before PMK-87.

`jiraDescriptor({ fetch = globalThis.fetch })`: `system: 'jira'`, `hosted: true`, `configProblems: jiraConfigProblems`, `settings: () => ({ defaults: builtInDefaults(), epicPrefix: null })`, `create` loads `tracker.mjs`. No `isEpicId` or `trackerBranch` until PMK-79 and PMK-77 decide them.

### CLI text output

`discover`, when the result has `site`:

```
site: acme.atlassian.net, viewer Test User, Jira Software paid
space: ENG Engineering (company-managed, software)
spaces:
  ENG  Engineering  company-managed
  OPS  Operations   team-managed
work types:
  Epic (epic), Story, Bug, Sub-task (subtask)
fields:
  estimate      customfield_10016  Story point estimate
  start_date    (none)
```

then the common lines (`statuses:` and the rest) as for Linear and GitHub. `capabilities` heads with `site`, `space` and `plan`.

### Runbook and E2E test

`docs/runbooks/discover-jira.md` covers: a config with `tracker.system: jira`, `site` and `space`; `JIRA_EMAIL` and `JIRA_API_TOKEN` exported; `pmkit validate`, `pmkit discover --json`, `pmkit capabilities --json`, and the failures (missing variables `AUTH`, a Data Center site `NOT_SUPPORTED`, an unknown space `NOT_CONFIGURED`, a missing `tracker.scope.space` from `validate`).

`scripts/runbook-discover-jira.test.mjs` runs the real CLI as a subprocess: a small launcher in a temporary folder sets `globalThis.fetch` to `fakeJiraFetch(JIRA_SITE_ROUTES)` and then calls `run` from `scripts/pmkit.mjs`, so no socket opens. It walks the runbook on a company-managed space and on a team-managed space, and asserts that neither `FAKE_TOKEN`, `FAKE_EMAIL` nor the Basic header appears in stdout or stderr **(builder's call: no flag or env hook in the CLI for a fake fetch)**.

### Live check

Skipped: no Jira credentials. The PR lists it open, and a follow-up issue in EPC-14 (`EPC-7 follow-ups`) holds it: run `discover` and `capabilities` on a company-managed and a team-managed space, and check the field-role rules and the `style` values.

## Acceptance criteria map

| Criterion | Design part | Tests |
|---|---|---|
| 1. `discover` returns spaces, work types, statuses with categories and the field for each role | "Discovery: the raw data", "Discovery: the view" | `discovery.test.mjs` on the fake fetch: spaces with style; work types with level and statuses; categories from `statusCategory` and from `mappings.status`; each field-role rule and the mapping override; optional reads failing to warnings; an unknown space. E2E: `discover --json`. |
| 2. Handles company-managed and team-managed spaces | "Both space styles" | Unit: a team-managed space whose scoped field and work type appear, and another space's scoped field that does not. E2E: both styles. |
| 3. `capabilities` reports the paths the plan allows | "The manifest" | `manifest.test.mjs`: each row's site answer for paid, free and unlicensed Jira Software, a business space, settings on and off, the served rule. E2E: `capabilities --json`. |
| ADR 0013: scope keys required | "Config" | `adapter.test.mjs` for each problem; E2E `validate`. |

## Decisions

| Decision | Reason |
|---|---|
| Linear-shaped split (approach 1) | The precedent later issues extend. |
| Optional reads degrade to warnings | A board or settings read the token's owner cannot make should not hide the space. |
| `absent` until served, site answer in `detail.site` | No command treats a stub as working; the site's answer is still reported. Same rule Linear uses for an offer pmkit does not serve. |
| Field roles map by field id | Ids are stable; names repeat across team-managed spaces. The issue quotes `customfield_10016`. |
| No cache, no mapping check yet | No operation reads discovery before PMK-77. |
| No ADR | ADR 0013 holds the hard-to-reverse choices; the field-id mapping follows the issue's quote (open question 3). |

## Risks

- Nothing is verified live. The `style` values, the field-role rules and the custom type keys come from Atlassian's OpenAPI documents and their field names; the live-check follow-up covers them.
- `/rest/api/3/field` lists every site field; on a large site that is one big answer, read once per run.

## Check step (E2E)

New flow: `discover` and `capabilities` on a Jira site. The Check step adds the runbook and its E2E test and runs every `scripts/runbook-*.test.mjs`.

## Open questions for the owner

1. **Setup.** ADR 0013 describes what `/pmkit:setup` does for Jira but no EPC-7 issue owns `init --tracker jira` and the setup questions (status mappings for `backlog`, `in_review`, `canceled`; field roles; types). Recommendation: keep them out of PMK-76 (its criteria do not name setup) and open a follow-up issue in EPC-7; until then a user writes `.pmkit/config.yaml` by hand, which costs nothing while every operation is a stub.
2. **Unserved capabilities.** Recommendation as above: `absent` with `detail.site` until PMK-77 to PMK-80 serve them. The alternative reports the site's path as the entry's path now, which reads as "works" while every operation is a stub.
3. **Field mapping value.** Recommendation: `mappings.fields.<role>` holds the Jira field id (`customfield_10016`), not its name.

## Left to the builder

- The layout inside each new module, and the wording of warnings and hints within the rules above.
- The fixture contents of `JIRA_SITE_ROUTES`.
