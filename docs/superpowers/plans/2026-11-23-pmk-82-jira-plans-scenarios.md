# PMK-82 jira-plans-scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `/pmkit:jira:plans-scenarios` command over two CLI reads, `jira plans list` and `jira plans get <id>`, that read Jira Premium plans, their default scenario, scheduling (dependency mode), cross-project releases and per-team capacity, and answer `available: false` without Premium.

**Architecture:** `client.paginate` learns Jira's cursor paging. A new `scripts/lib/jira/plans.mjs` holds `planOperations({ client, site })` with pure mappers; the Jira tracker exposes it as `tracker.plans` beside the contract operations (as GitHub exposes `discussions`). `scripts/pmkit.mjs` gets a `jira: true` command flag and `ctx.jira(feature)`, as `linear: true` / `github: true`.

**Tech Stack:** Node 18+ ES modules, no dependencies, `node:test`, ESLint via `npm run lint`.

**Spec:** `docs/superpowers/specs/2026-11-23-pmk-82-jira-plans-scenarios-design.md`

## Global Constraints

- No dependencies (ADR 0003). Requests only through `client.request` / `client.paginate` (paths under `/rest/api/3/`).
- Read-only: no POST/PUT/DELETE to any Plans route.
- Not filtered by `tracker.scope.space`: plans are site-wide (Q4).
- 403 from Plans → `{ available: false, reason: 'premium', enableHint: "Jira Plans need Jira Premium or Enterprise, and the token's owner needs the Administer Jira global permission", site }`. 401 stays `AUTH`; 404 on `get` stays `NOT_FOUND`.
- Only the default scenario is shown; text and command file say other scenarios are not readable through Jira's public API (Q1).
- Enum values in snake case: `Active`→`active`, `PlanOnly`→`plan_only`, `StoryPoints`→`story_points`, `SprintDates`→`sprint_dates`, `Sequential`→`sequential`, `Scrum`→`scrum`.
- Every commit message names `(PMK-82)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A plan with zero teams, no `crossProjectReleases` or no `scheduling`: `get` returns `teams: []`, `releases: []`, `scheduling: null`, no crash. (Task 2 test `get tolerates a bare plan`.)
- A plan id that is not in the list (trashed/archived/unknown): `get` still reads `/plan/{id}`; `scenario` is `null` when the list does not hold it. (Task 2 test.)
- A plan id with a slash or dot segment (`../x`): refused as `INVALID_INPUT` before any request. (Task 2 test.)
- A team whose detail read is 404: left out with a warning naming it; other failures throw. (Task 2 test.)
- Cursor paging that repeats the same `nextPageCursor`: fails as a broken page, no endless loop. (Task 1 test.)

---

### Task 1: Cursor paging in `client.paginate`

**Files:**
- Modify: `scripts/lib/jira/client.mjs` (`nextPosition`, the `where` query in `paginate`)
- Test: `scripts/lib/jira/client.test.mjs`

**Interfaces:**
- Produces: `client.paginate(path, { key: 'values' })` follows `nextPageCursor` (sent back as `cursor`), ends at `last: true` or no cursor. Result `{ items, hasMore }` unchanged.

- [ ] **Step 1: Write the failing tests**

```js
test('paginate follows nextPageCursor as cursor until last', async () => {
  const plans = 'GET /rest/api/3/plans/plan'
  const { fetch, client } = setup({ [plans]: answers([{ values: [1], nextPageCursor: 'c1', last: false }, { values: [2], last: true }]) })
  assert.deepEqual(await client.paginate('/rest/api/3/plans/plan', { query: { includeArchived: false } }), { items: [1, 2], hasMore: false })
  assert.deepEqual(pageCalls(fetch, plans).map(queryOf), [
    { includeArchived: 'false', maxResults: '50' },
    { includeArchived: 'false', maxResults: '50', cursor: 'c1' },
  ])
})

test('paginate fails on a repeated nextPageCursor', async () => {
  const plans = 'GET /rest/api/3/plans/plan'
  const { client } = setup({ [plans]: answers([{ values: [1], nextPageCursor: 'c1', last: false }, { values: [2], nextPageCursor: 'c1', last: false }]) })
  await assert.rejects(client.paginate('/rest/api/3/plans/plan'), { code: 'UPSTREAM' })
})
```

- [ ] **Step 2:** `node --test scripts/lib/jira/client.test.mjs` → the two new tests FAIL.
- [ ] **Step 3:** In `nextPosition`, a page with a non-empty string `nextPageCursor` gives `{ more: page.last !== true, cursor, broken: cursor === previous cursor }`; a cursor list without one ends. In `paginate`, `where` sends `{ cursor }` when the position has one. Offset and token behavior unchanged.
- [ ] **Step 4:** `node --test scripts/lib/jira/client.test.mjs` → all PASS.
- [ ] **Step 5:** Commit `feat: Jira client follows cursor pages (PMK-82)`.

### Task 2: `planOperations` in `scripts/lib/jira/plans.mjs`

**Files:**
- Create: `scripts/lib/jira/plans.mjs`, `scripts/lib/jira/plans.test.mjs`
- Modify: `scripts/lib/jira/tracker.mjs` (return `{ ...operations, plans }`, the way `scripts/lib/github/tracker.mjs:244` adds `discussions`)

**Interfaces:**
- Consumes: Task 1 `client.paginate`; `client.request('GET', path)`; `PmkitError` from `../errors.mjs`.
- Produces:
  - `planOperations({ client, site }) → { list({ archived?, trashed?, limit? }), get(id) }`
  - `list` → `{ available: true, site, plans: [{ id, name, status, scenario: { id, default: true } | null, sources: [{ type, id }] }], hasMore, warnings: [] }`
  - `get(id)` → `{ available: true, site, plan: { id, name, status, lead, lastSaved, sources, scenario, scheduling: { dependencies, estimation, inferredDates, startDate, endDate } | null, releases: [{ name, versionIds }], teams: [{ id, type, name, planningStyle, sprintLength, capacity, capacityUnit, source, members }] }, warnings }`
  - Off: `{ available: false, reason: 'premium', enableHint, site }` (plus `plans: [], hasMore: false` on `list`).
  - Exported constant `PLANS_HINT` (the hint string from Global Constraints).
  - `tracker.plans` on the Jira tracker.

Calls: `list` → `paginate('/rest/api/3/plans/plan', { query: { includeArchived, includeTrashed }, pageSize: 50, limit })`. `get` → `request GET /rest/api/3/plans/plan/{id}`, `paginate('/rest/api/3/plans/plan/{id}/team')`, then per team `GET .../team/planonly/{teamId}` or `.../team/atlassian/{teamId}`, and the list (with archived and trashed) for `scenarioId`. Ids are strings. `id` must match `/^\d+$/` else `INVALID_INPUT` (`Pass the plan id that jira plans list shows`). `capacityUnit`: estimation unit (`story points`, `days`, `hours`) + ` per sprint` for Scrum, ` per week` for Kanban; `null` without scheduling. Atlassian team `name: null`, `members: []`. A 403 is a `PmkitError` with `code === 'AUTH'` and `details.jira.status === 403`.

- [ ] **Step 1: Write the failing tests** (fake fetch via `fakeJiraFetch` from `scripts/fake-jira-api.mjs`, client from `createJiraClient({ env: FAKE_ENV, tracker: TRACKER, fetch })`):
  - `list maps plans with their default scenario and sources` — values `[{ id: '12', name: 'Q1 roadmap', status: 'Active', scenarioId: '34', issueSources: [{ type: 'Board', value: 7 }] }]` → `plans[0]` deep-equals `{ id: '12', name: 'Q1 roadmap', status: 'active', scenario: { id: '34', default: true }, sources: [{ type: 'board', id: 7 }] }`, `available: true`, `site: 'acme.atlassian.net'`.
  - `list sends includeArchived and includeTrashed only when asked` — query has `includeArchived: 'true'` for `{ archived: true }`, absent by default.
  - `list answers available false on a 403` — route `{ status: 403, json: { errorMessages: ['no premium'] } }` → deep-equals `{ available: false, reason: 'premium', enableHint: PLANS_HINT, site: 'acme.atlassian.net', plans: [], hasMore: false }`.
  - `list keeps a 401 as AUTH` — rejects `{ code: 'AUTH' }`.
  - `get maps scheduling, releases and both team kinds` — plan `{ id: 12, name, status: 'Active', leadAccountId: 'acc-1', lastSaved, issueSources, scheduling: { dependencies: 'Sequential', estimation: 'StoryPoints', inferredDates: 'SprintDates', startDate: { type: 'DueDate' }, endDate: { type: 'TargetEndDate' } }, crossProjectReleases: [{ name: 'Spring launch', releaseIds: [10001] }] }`, teams `[{ id: '5', type: 'PlanOnly', name: 'Payments' }, { id: 'ab-1', type: 'Atlassian' }]`, planonly `{ id: 5, name: 'Payments', capacity: 30, issueSourceId: 7, memberAccountIds: ['acc-1'], planningStyle: 'Scrum', sprintLength: 14 }`, atlassian `{ id: 'ab-1', capacity: 10, issueSourceId: 7, planningStyle: 'Kanban', sprintLength: null }` → `plan.id === '12'`, `scheduling.dependencies === 'sequential'`, `estimation === 'story_points'`, `inferredDates === 'sprint_dates'`, `releases` deep-equals `[{ name: 'Spring launch', versionIds: [10001] }]`, `teams[0].capacityUnit === 'story points per sprint'`, `teams[1]` deep-equals `{ id: 'ab-1', type: 'atlassian', name: null, planningStyle: 'kanban', sprintLength: null, capacity: 10, capacityUnit: 'story points per week', source: 7, members: [] }`, `scenario` deep-equals `{ id: '34', default: true }`.
  - `get tolerates a bare plan` — plan `{ id: 12, name: 'x', status: 'Active' }`, no teams, not in the list → `scheduling: null`, `releases: []`, `teams: []`, `sources: []`, `scenario: null`.
  - `get leaves out a team that is gone, with a warning` — planonly route 404 → `teams` empty, `warnings[0]` matches `/team 5/`.
  - `get answers available false on a 403 and NOT_FOUND on a 404`.
  - `get refuses a plan id that is not a number before any request` — `get('../x')` rejects `{ code: 'INVALID_INPUT' }`, `fetch.calls` has no Plans call.
  - In `scripts/lib/jira/tracker.test.mjs`: `the Jira tracker exposes plans` — `typeof tracker.plans.list === 'function'`.
- [ ] **Step 2:** `node --test scripts/lib/jira/plans.test.mjs scripts/lib/jira/tracker.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `plans.mjs` and the tracker line. Plans calls do not go through `guarded` (no mapping depends on them) **(builder's call)**.
- [ ] **Step 4:** Tests PASS; `npm run lint` clean.
- [ ] **Step 5:** Commit `feat: read Jira plans, teams and capacity (PMK-82)`.

### Task 3: CLI `jira plans list` and `jira plans get`

**Files:**
- Modify: `scripts/pmkit.mjs` (comment near line 947; `ctx.jira` beside `ctx.github` ~line 5027; the `command.jira` refusal beside `command.github` ~line 5055; two COMMANDS entries after the GitHub draft-issues ones; two text formatters)
- Test: `scripts/cli-plans-jira.test.mjs` (session as in `scripts/cli-jira.test.mjs`, routes added to `fakeJiraIssues().routes`)

**Interfaces:**
- Consumes: Task 2 `tracker.plans`.
- Produces: `jira plans list [--archived] [--trashed] [--limit n]` and `jira plans get <id>`, `jira: true`, read-only. `--json` prints the Task 2 result in `data`. Text: list → one line per plan `<id>  <name>  (<status>)  scenario <id>`; off → `Jira Plans are not available on <site>: <enableHint>`; get → plan line, `dependencies: sequential`, `estimation`, `scenario: <id> (default; other scenarios are not readable through Jira's public API)`, a line per release, a line per team `<name or id>  <planningStyle>  capacity <n> <unit>`.

- [ ] **Step 1: Write the failing tests**
  - `jira plans list prints the plans in JSON and text` — JSON `data.plans[0].id === '12'`; text includes `Q1 roadmap`.
  - `jira plans get prints the dependency mode, the scenario note and team capacity` — text matches `/dependencies: sequential/`, `/other scenarios are not readable/`, `/capacity 30 story points per sprint/`.
  - `jira plans list says Plans are not available on a 403` — exit 0, `data.available === false`, text includes `Jira Premium`.
  - `jira plans list on a Local tracker is NOT_SUPPORTED` — `makeRepo('basic')` unchanged, exit 2, error code `NOT_SUPPORTED`, message includes `works only with the Jira tracker`.
  - `jira plans get without an id is a usage error`.
- [ ] **Step 2:** `node --test scripts/cli-plans-jira.test.mjs` → FAIL.
- [ ] **Step 3:** Implement the wiring and commands. Also add both names to whatever help/command-list test enumerates COMMANDS, if `npm test` asks.
- [ ] **Step 4:** `npm test` and `npm run lint` PASS.
- [ ] **Step 5:** Commit `feat: jira plans list and get commands (PMK-82)`.

### Task 4: The `/pmkit:jira:plans-scenarios` command file and listings

**Files:**
- Create: `commands/jira/plans-scenarios.md`
- Modify: `skills/pmkit/SKILL.md` (table row after the Linear triage row), `README.md` (command list), `scripts/plugin.test.mjs` (`COMMANDS` gets `jira: ['plans-scenarios']`; a test that the file stops on another tracker in step 1, calls `jira plans list` in step 2 and `jira plans get` in step 4, and has no `--dry-run`)

**Interfaces:**
- Consumes: Task 3 CLI names.

Steps of the command file, in the shape of `commands/linear/triage-rotation.md`: (1) `capabilities --json`, stop when `tracker` is not `jira`; (2) `jira plans list --json`; on `available: false` print `reason` and `enableHint`, say the plans capability is absent on this site, stop; (3) show the plans as a table (id, name, status, default scenario, sources); with more than one and none named in the arguments, ask which with `AskUserQuestion`; (4) `jira plans get <id> --json`; show scheduling, the default scenario with the note that other scenarios are not readable through Jira's public API, the cross-project releases and each team's style, sprint length and capacity; (5) say the dependency setting governs how linked work schedules and offer `/pmkit:issues:dependencies` for the links. Confirmation points: only the plan choice. No writes.

- [ ] **Step 1:** Add the `plugin.test.mjs` test and `COMMANDS` entry; `node --test scripts/plugin.test.mjs` → FAIL.
- [ ] **Step 2:** Write the command file and listings.
- [ ] **Step 3:** `npm test` and `npm run lint` PASS.
- [ ] **Step 4:** Commit `feat: the /pmkit:jira:plans-scenarios command (PMK-82)`.

### Task 5 (SPEC-SS Check): runbook and its E2E test

**Files:**
- Create: `docs/runbooks/plans-jira.md`, `scripts/runbook-plans-jira.test.mjs`
- Modify: `scripts/fake-jira-issues.mjs` (Plans routes with a `plans` option: a Premium fixture by default, `plans: false` answers 403), if the CLI test of Task 3 did not already add them there.

Runbook in the format of `docs/runbooks/time-jira.md`, with "Live check: skipped" naming the EPC-14 follow-up. Steps: list plans, get the plan (dependency mode, scenario note, team capacity), a site without Premium (`available: false`). The test runs each step through the real CLI subprocess, as `scripts/runbook-time-jira.test.mjs` does, with an env switch for the 403 site, and asserts each step's documented expectation.

- [ ] **Step 1:** Write the test against the runbook; run → FAIL (no runbook/fixture).
- [ ] **Step 2:** Write the runbook and fixture.
- [ ] **Step 3:** `npm test` PASS.
- [ ] **Step 4:** Commit `docs: Jira plans runbook (PMK-82)`.
