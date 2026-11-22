# PMK-76 Jira discovery and capability manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register a `jira` tracker adapter whose `discover` and `capabilities` read one Jira Cloud site and space through the PMK-75 client.

**Architecture:** Linear-shaped split under `scripts/lib/jira/`: `discovery.mjs` (raw data + view), `manifest.mjs` (20 capability entries), `tracker.mjs` (discover, capabilities, stubs), `adapter.mjs` (descriptor + config rules). Tests run on `fakeJiraFetch`; the E2E test runs the real CLI in a child process with `globalThis.fetch` replaced by the fake.

**Tech Stack:** Node 18 ES modules, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md` (ADR 0013, ADR 0014).

## Global Constraints

- Every Jira call goes through `createJiraClient` (`scripts/lib/jira/client.mjs`); nothing else reads `JIRA_EMAIL` / `JIRA_API_TOKEN`.
- No request from `npm test`; no token, email or Basic header in any output.
- `discover --json` puts `auth: { source, viewer, site }` first.
- `mappings.fields.<role>` holds a Jira field id or `none` (ADR 0014).
- Every contract operation but `discover` and `capabilities` throws `NOT_SUPPORTED`, `the Jira adapter does not implement <operation> yet`, next step `Set tracker.system to local in .pmkit/config.yaml to use this command now`.
- Commit messages carry `(PMK-76)`.

## Review Focus

- A team-managed space next to another team-managed space with a same-named "Story point estimate": only the configured space's field shows (Task 2 test `scoped fields of another space are dropped`).
- A token without board or admin rights (boards/configuration/license read `AUTH`): `discover` still succeeds with warnings (Task 2 test `optional reads degrade to warnings`).
- `RATE_LIMITED` on an optional read propagates instead of being swallowed (Task 2 test).
- `tracker.scope.space` set to a key the site lacks: `NOT_CONFIGURED` with `/pmkit:setup`, not a raw 404 (Task 2).
- A status whose category key is `undefined`: counts as `in_progress` with a warning (Task 2).

---

### Task 1: Config rules and the adapter skeleton

**Files:**
- Create: `scripts/lib/jira/adapter.mjs`, `scripts/lib/jira/adapter.test.mjs`
- Modify: `scripts/lib/jira/client.mjs` (export `HOST`), `scripts/lib/adapters.mjs` (register `jira: jiraDescriptor()`), `schemas/pmkit.config.schema.json` (scope description names Jira's `site` and `space`)
- Modify tests: `scripts/adapters.test.mjs`, `scripts/config.test.mjs`, `scripts/cli-hosted.test.mjs`: their unsupported-tracker example becomes `gitlab`; the registry test expects `['local', 'linear', 'github', 'jira']`.

**Interfaces:**
- Produces: `jiraConfigProblems(pmkit) => string[]`; `jiraDescriptor({ fetch } = {}) => AdapterDescriptor` with `create(config, { now, env })` importing `./tracker.mjs` `createJiraTracker(config, { env, now, fetch })`.

- [ ] Step 1: tests in `adapter.test.mjs`: missing site → `tracker.scope.site is required for jira`; `https://acme.atlassian.net` → `tracker.scope.site must be a host such as acme.atlassian.net`; missing space → `tracker.scope.space is required for jira`; `eng` → `tracker.scope.space must be a space key such as ENG`; `{ site: 'acme.atlassian.net', space: 'ENG' }` → `[]`; descriptor `system: 'jira'`, `hosted: true`, `settings().epicPrefix === null`. Plus `loadConfig` on a jira config without space lists the problem in `pmkitProblems`.
- [ ] Step 2: run `node --test scripts/lib/jira/adapter.test.mjs` → FAIL (module missing).
- [ ] Step 3: implement; space key rule `/^[A-Z][A-Z0-9_]+$/`; site check lowercases then tests `HOST`.
- [ ] Step 4: run the file plus `scripts/adapters.test.mjs scripts/config.test.mjs scripts/cli-hosted.test.mjs` → PASS.
- [ ] Step 5: commit `feat: register the Jira adapter and check its scope (PMK-76)`.

### Task 2: Discovery

**Files:**
- Create: `scripts/lib/jira/discovery.mjs`, `scripts/lib/jira/discovery.test.mjs`
- Modify: `scripts/fake-jira-api.mjs`: export `jiraSiteRoutes({ style = 'company-managed' } = {})`, the routes of the design's discovery calls for space `ENG` (a `software` space; team-managed variant uses `style: 'next-gen'`, scoped work types and a scoped `Story point estimate` field for ENG plus one scoped to another space id).

**Interfaces:**
- Consumes: `createJiraClient` (`request`, `paginate`, `session`).
- Produces: `fetchDiscovery(client, { space, now }) => Promise<Raw>` (shape in the spec, "Discovery: the raw data"); `discoveryView(raw, pmkit, { session }) => View` (spec, "Discovery: the view"; `auth` first; `raw` as a hidden property); `categoryOfStatus(key) => 'todo'|'in_progress'|'done'|null`.

- [ ] Step 1: tests:
  - `spaces carry their style`: `classic` → `company-managed`, `next-gen` → `team-managed`.
  - `work types have a level and their statuses`: `hierarchyLevel` -1 → `subtask`, 0 → `standard`, 1 → `epic`, 2 → `2`.
  - `statuses take the Jira category or the mapping`: `new`/`indeterminate`/`done` → `todo`/`in_progress`/`done`; `mappings.status.in_review: Review` wins; `undefined` key → `in_progress` + warning; a mapping naming a missing status → warning.
  - `fields resolve per role`: estimate from the board's `estimation.field.fieldId`; without a board, from custom type `com.pyxis.greenhopper.jira:jsw-story-points`; priority `priority`, target_date `duedate`, assignee `assignee`, time_spent `timespent`, sprint `gh-sprint` custom type, start_date by name `Start date`, acceptance_criteria `null`; `mappings.fields.estimate: customfield_10099` wins when present, warns and falls back when absent; `none` → `null`. `estimate.unit` `hours` for `timeoriginalestimate`.
  - `scoped fields of another space are dropped` (team-managed fixture).
  - `optional reads degrade to warnings`: labels, license, configuration, boards answering 403 → `null` + one warning each, `discover` still resolves; `RATE_LIMITED` (429) on the license rejects.
  - `an unknown space is NOT_CONFIGURED` with message `tracker.scope.space names XYZ, which acme.atlassian.net does not have or the token's owner cannot browse`, next step `/pmkit:setup`.
  - `a business space reads no board` (no board route called).
  - `the view leads with auth and names the viewer`: `Object.keys(view)[0] === 'auth'`, `viewer: { id: 'acc-1', name: 'Test User' }`, `members` is the viewer.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement as the spec says. Required reads: spaces, space, statuses, fields; optional (via a local `tolerant` mapping `AUTH`/`NOT_FOUND`/`UPSTREAM` to `null`): labels, license, configuration, boards and board configuration.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit `feat: discover a Jira site and space (PMK-76)`.

### Task 3: Manifest

**Files:** Create `scripts/lib/jira/manifest.mjs`, `scripts/lib/jira/manifest.test.mjs`.

**Interfaces:**
- Consumes: Raw from Task 2, `CAPABILITIES` and `CAPACITY_FILE`.
- Produces: `buildJiraCapabilities(raw, pmkit) => Entry[]` (20, `CAPABILITIES` order); `SERVED` (`{ linked_code: true }`), `SERVED_IN` (capability → issue id for the hint).

- [ ] Step 1: tests: order and count equal `CAPABILITIES`; every capability but `linked_code` is `absent`; one whose site answer is not absent carries `detail.site` (e.g. `cycles` paid + scrum → `detail.site: 'native'`, hint `The Jira adapter does not serve cycles yet (PMK-78)`); `cycles` with `unlicensed` software → `detail` has no `site`, hint `Sprints need Jira Software`; no scrum board → `Sprints need a Scrum board in space ENG`; `time_tracking` off → hint `Turn on time tracking in Jira's global settings`; `dependencies` site native when `issueLinking` on; `linked_code` `derived` `{ source: 'git' }` with `Set git_host in .pmkit/config.yaml` when the git host is `none`; a test that flips `SERVED.cycles` via an injected map shows the site answer becomes the entry's path.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement `siteAnswers(raw, pmkit)` per the spec table, then the served rule. `buildJiraCapabilities(raw, pmkit, served = SERVED)`.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit `feat: build the Jira capability manifest (PMK-76)`.

### Task 4: Tracker and CLI text

**Files:** Create `scripts/lib/jira/tracker.mjs`, `scripts/lib/jira/tracker.test.mjs`; modify `scripts/pmkit.mjs` (`discover` and `capabilities` text for a result with `site`).

**Interfaces:**
- Produces: `createJiraTracker(config, { env, now, fetch })` → every `TRACKER_OPERATIONS` name; `discover({ refresh })` returns the view plus `viewer`; `capabilities()` returns `{ tracker: 'jira', gitHost, generatedAt, discoveredAt, site, space, plan, capabilities, warnings }`.

- [ ] Step 1: tests: `assertTracker` passes; a missing `JIRA_API_TOKEN` fails at creation with `AUTH` and zero fetch calls; one discovery per run (second `capabilities()` sends no new call); `discover({ refresh: true })` reads again; `getIssue` rejects `NOT_SUPPORTED` with the stub message; a `DataCenter` serverInfo rejects `NOT_SUPPORTED`. CLI text: `run(['discover'])` with the adapter's fake fetch prints `site: acme.atlassian.net, viewer Test User` and `space: ENG`; `capabilities` text has a `site` line.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement; CLI tests pass `adapters: { ...ADAPTERS, jira: jiraDescriptor({ fetch }) }` to `run`.
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit `feat: add the Jira tracker with discover and capabilities (PMK-76)`.

### Task 5: Runbook and E2E test

**Files:** Create `docs/runbooks/discover-jira.md`, `scripts/runbook-discover-jira.test.mjs`.

- [ ] Step 1: test: in a temp repo (`makeRepo('basic')` with `.pmkit/config.yaml` set to `system: jira`, `scope: { site: acme.atlassian.net, space: ENG }`), a launcher `.mjs` written to a temp folder imports `fakeJiraFetch`/`jiraSiteRoutes` by file URL, sets `globalThis.fetch`, imports `run` from `scripts/pmkit.mjs` and writes its result. Steps follow the runbook: `validate --json` ok; `discover --json` for both styles (spaces, work types, statuses, `fields.estimate.id`); `capabilities --json` (20 entries); `JIRA_API_TOKEN` unset → `AUTH`; DataCenter → `NOT_SUPPORTED`; space removed from config → `validate` lists `tracker.scope.space is required for jira`; no output holds `FAKE_TOKEN`, `FAKE_EMAIL` or `FAKE_HEADER`. A test also checks each runbook step's command appears in the runbook.
- [ ] Step 2: run → FAIL (runbook missing).
- [ ] Step 3: write the runbook (Before you start, Steps, Failures), with the live check marked skipped.
- [ ] Step 4: run → PASS; then `npm test` and `npm run lint` → PASS.
- [ ] Step 5: commit `test: add the Jira discovery runbook and its E2E test (PMK-76)`.
