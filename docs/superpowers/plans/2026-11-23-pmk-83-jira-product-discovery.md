# PMK-83 jira-product-discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pmkit jira ideas list` and `pmkit jira ideas connect`, and the `/pmkit:jira:product-discovery` command over them: Jira Product Discovery ideas with votes, insights (reported unread) and connected epics, and a confirmed link from an idea to an epic.

**Architecture:** A Jira-only feature beside the tracker contract, as `tracker.plans` (PMK-82): `scripts/lib/jira/ideas.mjs` exports `ideaOperations`, the Jira tracker exposes it as `tracker.ideas`, and two `jira: true` CLI commands call it through `ctx.jira('ideas')`. REST v3 only; the client does not change.

**Tech Stack:** Node 18+ ES modules, no dependencies, `node:test`, the stateful fake Jira (`scripts/fake-jira-issues.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-23-pmk-83-jira-product-discovery-design.md`

## Global Constraints

- No new dependency (ADR 0003). No new client path: every call is `/rest/api/3/...` (ADR 0013).
- Every commit message carries `(PMK-83)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Insights are never read: every idea has `insights: null`, and a non-empty list carries the warning `Jira's REST API does not return Jira Product Discovery insights, so insights are unread`.
- A vote Jira did not return is `null`, never `0`, with one warning for the list: `Jira did not return the votes of <n> ideas`.
- Not available: `{ available: false, reason: 'no_discovery_project', enableHint: 'Create a Jira Product Discovery project on <site>, or check that the token's owner can browse one', site }`.
- Delivery link type names (case-insensitive): `Polaris work item link`, `Polaris issue link`. The epic is the side that "implements".
- `connect` accepts only an epic of `tracker.scope.space` (ADR 0017) and an idea of a Product Discovery project; anything else is `NOT_FOUND`.
- Live Jira checks are skipped and filed under EPC-14.

## Review Focus

1. A JPD project key in lower case (`--project idea`): matched case-insensitively. Test in Task 1.
2. An idea already connected to the epic: `connect` writes nothing and `before` equals `after`. Test in Task 1.
3. `connect` with the arguments swapped (an epic as the idea): `NOT_FOUND` naming the idea, no write. Test in Task 1.
4. A site whose delivery link type is reversed (`inward: 'implements'`): the epic still ends up the implementing side. Test in Task 1.
5. `--limit 0` or a non-number: usage error before any request. Test in Task 2.

---

### Task 1: The ideas reader and connector

**Files:**
- Create: `scripts/lib/jira/ideas.mjs`, `scripts/lib/jira/ideas.test.mjs`
- Modify: `scripts/fake-jira-api.mjs` (nothing unless a site route is needed), `scripts/fake-jira-issues.mjs` (option `discovery`)

**Interfaces:**
- Produces: `export const IDEAS_HINT = (site) => string`; `export const INSIGHTS_UNREAD = "Jira's REST API does not return Jira Product Discovery insights, so insights are unread"`; `export function ideaOperations({ client, site, raw, epics, requireActor })` returning `{ list({ project, limit } = {}), connect(idea, epic, actor, { dryRun = false } = {}) }`.
  - `raw()`: async, the raw discovery (`spaces` with `type`, `linkTypes`).
  - `epics.getDeliverable(id)`: async, the epic or `NOT_FOUND` (PMK-79).
  - `requireActor(actor)`: async, the issue ops' check.
  - `list` returns `{ available: true, site, project: { key, name }, ideas: [{ id, title, status, votes: [{ field, value }], insights: null, epics: [key] }], hasMore, warnings }` or the not-available shape with `ideas: []`, `hasMore: false`.
  - `connect` returns `{ idea, epic, linkType, before: { epics }, after: { epics } }`.
- Fake: `fakeJiraIssues({ discovery: true })` adds the project `{ id: '10003', key: 'IDEA', name: 'Ideas', projectTypeKey: 'product_discovery' }` to `project/search`, a field `{ id: 'customfield_10101', name: 'Votes', schema: { type: 'number', custom: 'jira.polaris:votes' }, scope: { type: 'PROJECT', project: { id: '10003' } } }` to `field`, the link type `{ id: '10010', name: 'Polaris work item link', inward: 'is implemented by', outward: 'implements' }` to `issueLinkType`, and, when the state has none, the items `IDEA-1` ("Bulk export", status `Discovery`, votes 7) and `IDEA-2` ("Dark mode", status `Discovery`, `customfield_10101` absent). The fake's JQL `project = "X"` matches the item key's prefix instead of always `ENG`, and it accepts `ORDER BY created DESC, key DESC`. Default `discovery: false` keeps every existing test unchanged.

- [ ] **Step 1: Write the failing tests** in `scripts/lib/jira/ideas.test.mjs`, with a `setup(options)` over `fakeJiraFetch(fakeJiraIssues({ discovery: true, ...options }).routes)`, a raw discovery read with `fetchDiscovery` from `./discovery.mjs` (or a hand-built `{ spaces, linkTypes }`), a stub `epics.getDeliverable` that knows `ENG-1` only, and `requireActor` that accepts `'acc-1'`:
  - `list reads the only JPD project's ideas, newest first, with votes and unread insights`: `result.project` is `{ key: 'IDEA', name: 'Ideas' }`; `ideas.map((i) => i.id)` is `['IDEA-2', 'IDEA-1']`; IDEA-1 `votes` is `[{ field: 'Votes', value: 7 }]`; every `insights` is `null`; `warnings` includes `INSIGHTS_UNREAD` and `'Jira did not return the votes of 1 ideas'`; the search JQL is `project = "IDEA" ORDER BY created DESC, key DESC` and its `fields` hold `summary,status,issuelinks,customfield_10101`.
  - `list matches --project case-insensitively, and an unknown or non-JPD key is NOT_FOUND` (`'idea'` works; `'ENG'` and `'NOPE'` reject with `code: 'NOT_FOUND'`).
  - `list with several JPD projects and no --project is INVALID_INPUT naming the keys` (message contains `IDEA, LAB`).
  - `list answers available false when the site has no JPD project` (deep-equals the not-available shape with `ideas: []`, `hasMore: false`) and makes no search call.
  - `list shows the epics connected by the delivery link, either direction`.
  - `list passes --limit and reports hasMore`.
  - `connect links the epic as the implementing side`: after the real run the fake has a link with `inward: 'ENG-1'`, `outward: 'IDEA-1'`, type `10010`; `after.epics` is `['ENG-1']`.
  - `connect dry run writes nothing`; `connect is a no-op when already connected` (`before` deep-equals `after`, no POST).
  - `connect follows a reversed link type` (type with `inward: 'implements'`: link posted with `inwardIssue: IDEA-1`, `outwardIssue: ENG-1`).
  - `connect refuses an idea that is not in a JPD project` (`ENG-1` as the idea: `NOT_FOUND`, no POST), `an epic getDeliverable does not know` (`NOT_FOUND`), `a site with no delivery link type` (`NOT_SUPPORTED`, message contains `delivery link type is missing`), and `another actor` (rejects with what `requireActor` throws).

- [ ] **Step 2: Run** `node --test scripts/lib/jira/ideas.test.mjs`. Expected: FAIL, `Cannot find module './ideas.mjs'`.

- [ ] **Step 3: Add the fake's `discovery` option**, then **implement `ideas.mjs`**:
  - JPD projects: `raw().spaces.filter((s) => s.type === 'product_discovery')`.
  - Votes fields: `GET /rest/api/3/field`, keep `schema.custom === 'jira.polaris:votes'` whose `scope.project.id` is the project's id or that has no scope.
  - Ideas: `client.paginate('/rest/api/3/search/jql', { query: { jql, fields }, key: 'issues', pageSize: Math.min(limit, 100), limit })` with default `limit` 50; `status` is `fields.status.name`.
  - Delivery type: the first of `raw().linkTypes` whose lowered name is in the two names; `epics` of an idea are the other side's keys of `fields.issuelinks` entries of that type, sorted, deduplicated.
  - `connect`: `requireActor`, read the idea with `GET /rest/api/3/issue/<key>?fields=issuelinks` only after checking its key's prefix is a JPD project (`NOT_FOUND` otherwise, and a 404 maps to `NOT_FOUND`), `epics.getDeliverable(epic)`, no-op when connected, `POST /rest/api/3/issueLink` with the implementing side chosen from the type's `outward`/`inward` text (`outward === 'implements'`: `inwardIssue` is the epic).

- [ ] **Step 4: Run** `node --test scripts/lib/jira/ideas.test.mjs scripts/fake-jira-issues.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: read Jira Product Discovery ideas and connect one to an epic (PMK-83)`.

### Task 2: Tracker and CLI wiring

**Files:**
- Create: `scripts/lib/jira/ideas-text.mjs`, `scripts/lib/jira/ideas-text.test.mjs`, `scripts/cli-ideas-jira.test.mjs`
- Modify: `scripts/lib/jira/tracker.mjs` (expose `ideas`), `scripts/pmkit.mjs` (two commands), `scripts/cli.test.mjs` (jira command list), `scripts/golden-cases.mjs`, `scripts/__goldens__/*/jira-ideas-*.txt` (regenerated)

**Interfaces:**
- Consumes: `ideaOperations` from Task 1.
- Produces: `listText(result)` and `connectText(result, dryRun)` in `ideas-text.mjs`; CLI `jira ideas list [--project KEY] [--limit n]` and `jira ideas connect <idea> <epic>` (`write: true`, takes `--dry-run`).
- `tracker.ideas = ideaOperations({ client, site: scope.site, raw: async () => (await discovery()).raw, epics: { getDeliverable: implemented.getDeliverable }, requireActor: issues.requireActor })`, with `connect` wrapped in `guarded` (it reads the epic mapping) and `list` not.

- [ ] **Step 1: Write the failing tests**:
  - `ideas-text.test.mjs`: the not-available text is `Jira Product Discovery is not available on acme.atlassian.net: <hint>`; a list line is `IDEA-1  Bulk export  (Discovery)  votes 7  insights unread  delivery ENG-1`, with `votes unread` for `null` and `delivery none` for `[]`; `connectText` says `would connect IDEA-1 to ENG-1` on a dry run, `connected IDEA-1 to ENG-1` otherwise, and `IDEA-1 is already connected to ENG-1` when `before` equals `after`.
  - `cli-ideas-jira.test.mjs` (pattern of `cli-plans-jira.test.mjs`, fake with `discovery: true`): `jira ideas list --json` exits 0 with two ideas and the insights warning; `jira ideas list --limit 0` exits 2 with a usage error and makes no request; `jira ideas connect IDEA-1 ENG-1 --dry-run --json` shows `after.epics` `['ENG-1']` and writes nothing, after an `epic create` made `ENG-1`; the real run then lists IDEA-1 with `epics: ['ENG-1']`; on a local tracker `jira ideas list` is `NOT_SUPPORTED`.
  - `cli.test.mjs`: the jira commands are `['jira plans list', 'jira plans get', 'jira ideas list', 'jira ideas connect']`.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/ideas-text.test.mjs scripts/cli-ideas-jira.test.mjs scripts/cli.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement**: `ideas-text.mjs`; `tracker.ideas`; the two commands next to `jira plans get`, `--limit` parsed with `whole` and at least 1, `connect` passing `await ctx.actor()` and `{ dryRun: ctx.dryRun }`; golden cases `'jira ideas list': []` and `'jira ideas connect': ['IDEA-1', 'ENG-1']` beside the plans ones.
- [ ] **Step 4: Run** `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, then `npm test`. Expected: PASS; the new goldens show `NOT_SUPPORTED` on the local fixtures.
- [ ] **Step 5: Commit** `feat: jira ideas list and connect commands (PMK-83)`.

### Task 3: Command file, runbook and E2E, docs

**Files:**
- Create: `commands/jira/product-discovery.md`, `docs/runbooks/product-discovery-jira.md`, `scripts/runbook-product-discovery-jira.test.mjs`, `scripts/__scenarios__/jira-product-discovery.mjs` (+ `.after.txt` if the scenario runner writes one)
- Modify: `scripts/plugin.test.mjs` (`jira: ['plans-scenarios', 'product-discovery']` and a step test), `skills/pmkit/SKILL.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the CLI of Task 2.

- [ ] **Step 1: Write the failing tests**:
  - `plugin.test.mjs`: `product-discovery.md stops on another tracker in step 1, lists in step 2, connects only after a dry run and one confirmation` (the text holds `capabilities --json`, `jira ideas list`, `jira ideas connect` with `--dry-run` before the line without it, and a `## Confirmation points` entry).
  - `runbook-product-discovery-jira.test.mjs` (pattern of `runbook-plans-jira.test.mjs`, launcher with `fakeJiraIssues({ discovery: !process.env.PMKIT_FAKE_NO_DISCOVERY })`): it reads the runbook's steps and runs them: list (2 ideas, insights unread), create an epic, connect dry run, connect, list again (IDEA-1 delivery ENG-1), connect again (no-op), and on a site without JPD `available: false`.
- [ ] **Step 2: Run** `node --test scripts/plugin.test.mjs scripts/runbook-product-discovery-jira.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write** the command file per the design's "Wiring" (steps 1 to 4, one confirmation point, the "If something is missing" list, insights unread said plainly), the runbook in the shape of `docs/runbooks/plans-jira.md` with a "Live check: skipped (no Jira credentials), see EPC-14" line, the scenario (local tracker, stops at step 1, as `jira-plans-scenarios.mjs`), and the SKILL.md row, README line and CHANGELOG entry.
- [ ] **Step 4: Run** `npm test` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: /pmkit:jira:product-discovery command and runbook (PMK-83)`.
