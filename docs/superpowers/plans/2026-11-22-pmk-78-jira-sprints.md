# PMK-78 Jira sprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Cycles and Capacity contract families on a Jira space's Scrum board: list, open (create and start), close, move issues, filter, capacity, history.

**Architecture:** A pure `scripts/lib/jira/sprints.mjs` (Jira sprint ↔ pmkit sprint, an item's sprint, dates) and `scripts/lib/jira/cycle-ops.mjs` (the ten operations), wired in `scripts/lib/jira/tracker.mjs` as `scripts/lib/github/cycle-ops.mjs` is on GitHub. Issue reads, writes and search in `issues.mjs`, `filter.mjs` and `issue-ops.mjs` learn the `sprint` field. The stateful fake gains the board's sprints and the Agile routes.

**Tech Stack:** Node 18+, ES modules, no dependencies, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md` (with ADR 0016).

## Global Constraints

- No dependencies (ADR 0003). `npm test` and `npm run lint` pass after every task.
- Test first on every task (AGENTS.md).
- Every commit message names `(PMK-78)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Agile API base: `/rest/agile/1.0`. Sprint list: `GET /board/{boardId}/sprint?state=future,active,closed` (offset page, key `values`). Create: `POST /sprint` `{ name, originBoardId, startDate, endDate, goal }`. Start/close: `POST /sprint/{id}` `{ state: 'active' | 'closed' }`. Move in: `POST /sprint/{id}/issue` `{ issues: [key] }`. Out: `POST /backlog/issue` `{ issues: [key] }`.
- Sprint state map: `future → planned`, `active → active`, `closed → closed`. Sprint id `String(sprint.id)`, valid when `/^[1-9][0-9]*$/`.
- Dates written as `<YYYY-MM-DD>T12:00:00.000Z`; read as the UTC date of the value; `null` when absent.
- Capacity store key: `jira:<site>/<board id>`.
- No live Jira: anything live is listed as skipped in the runbook and under EPC-14.

## Review Focus

1. A work item whose Sprint field holds only closed sprints and is unfinished reads as no sprint (Jira backlog), so `issues list --sprint none` shows it. Test in Task 1 (`sprintOf`) and Task 3 (search `none`).
2. `--sprint current` with no active sprint: writes refuse `INVALID_INPUT` and send nothing; search returns `[]`. Contract suite covers writes (Task 5); Task 3 adds the search test.
3. `cycle open` on a start in the future leaves the sprint `planned` and sends no start call. Test in Task 5.
4. A failed start after the create answers `UPSTREAM` with `details.created`, so the user knows the sprint exists. Test in Task 5.
5. A space with a Kanban board only: every cycle operation is `NOT_SUPPORTED` with the manifest hint. Test in Task 5 and the runbook.

---

### Task 1: The pure sprint model (`sprints.mjs`)

**Files:**
- Create: `scripts/lib/jira/sprints.mjs`, `scripts/lib/jira/sprints.test.mjs`

**Interfaces:**
- Produces:
  - `sprintKey(id: string): number | null`
  - `jiraDate(date: 'YYYY-MM-DD'): string` → `'<date>T12:00:00.000Z'`
  - `toSprint(sprint, entry = {}): PmkitSprint` with `id, name, start, end, goal, state, closed?, capacity, daysOff, capacityBase?` (use `baseField` from `../local/sprints.mjs`, `jiraTime` from `./issues.mjs`)
  - `ofBoard(sprints, boardId): JiraSprint[]` keeps `originBoardId === boardId` or absent
  - `sprintOf(values: JiraSprint[] | null, category: string, boardId): string | undefined` (ADR 0016: open sprint of the board, active first; else, when `category` is `done` or `canceled`, the board's closed sprint with the latest `completeDate`; else `undefined`; a value whose `boardId` is set and differs is skipped)
  - `readBoardSprints(client, boardId): Promise<JiraSprint[]>` (paginate, `state: 'future,active,closed'`, then `ofBoard`)

- [ ] **Step 1: Write the failing tests** in `sprints.test.mjs`:
  - `toSprint` of `{ id: 42, name: 'S1', state: 'closed', startDate: '2026-11-02T12:00:00.000Z', endDate: '2026-11-15T12:00:00.000Z', completeDate: '2026-11-15T17:00:00.000+0000', goal: 'Ship' }` deep-equals `{ id: '42', name: 'S1', start: '2026-11-02', end: '2026-11-15', goal: 'Ship', state: 'closed', closed: '2026-11-15T17:00:00.000Z', capacity: {}, daysOff: {} }`.
  - `toSprint({ id: 7, name: 'Undated', state: 'future' })` has `start: null, end: null, goal: '', state: 'planned'` and no `closed`.
  - `sprintOf([closed41, active42], 'in_progress', 1) === '42'`; `sprintOf([closed41], 'in_progress', 1) === undefined`; `sprintOf([closed40, closed41], 'done', 1) === '41'` (latest completeDate); `sprintOf([{ ...active42, boardId: 9 }], 'todo', 1) === undefined`; `sprintOf(null, 'todo', 1) === undefined`.
  - `sprintKey('42') === 42`, `sprintKey('0') === null`, `sprintKey('2026-11-02') === null`.
  - `jiraDate('2026-11-02') === '2026-11-02T12:00:00.000Z'`.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/sprints.test.mjs` → FAIL (module missing).
- [ ] **Step 3: Implement** the six exports.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat: map Jira sprints to pmkit sprints (PMK-78)`.

### Task 2: The fake's board sprints and Agile routes

**Files:**
- Modify: `scripts/fake-jira-issues.mjs`, `scripts/fake-jira-issues.test.mjs`

**Interfaces:**
- Produces: state key `sprints: []` (and `next.sprint` starting at 1); `fakeJiraIssues({ ..., sprints })` seeds Jira sprints. Each item stores its Sprint field at `fields.customfield_10020` (array of `{ id, name, state, boardId: 1, startDate, endDate, completeDate }`, `null` when never in one).
- Routes: `GET /rest/agile/1.0/board/{boardId}/sprint` (offset page, `state` filter), `GET /rest/agile/1.0/sprint/{sprintId}` (404 unknown), `POST /rest/agile/1.0/sprint` (201, `state: 'future'`; 400 when `originBoardId` is not 1 or `name` empty), `POST /rest/agile/1.0/sprint/{sprintId}` (`state: 'active'` only from `future` with both dates and no other active sprint; `state: 'closed'` only from `active`, sets `completeDate`; else 400; also accepts `name`, `goal`), `POST /rest/agile/1.0/sprint/{sprintId}/issue` (400 for a closed sprint; replaces the item's open sprint and appends; one changelog item `{ field: 'Sprint', fieldId: 'customfield_10020', fromString, toString }` with comma-joined names → use ids as strings in `from`/`to` and names in `fromString`/`toString`), `POST /rest/agile/1.0/backlog/issue` (removes open sprints, same changelog item). Closing a sprint leaves its unfinished items with the closed sprint in their field (no move).
- JQL: `sprint = "<id>"`, `sprint is EMPTY`, `sprint not in openSprints()`, and a parenthesized `(sprint is EMPTY OR sprint not in openSprints())`.
- `PUT /issue` with `customfield_10020` stays refused (`cannotSet`), so the adapter cannot cheat through fields.

- [ ] **Step 1: Write failing tests** in `fake-jira-issues.test.mjs`: create a sprint, start it (`state: 'active'`), move an item in, `GET` the item shows the sprint in `customfield_10020`; search `sprint = "1"` finds it; close the sprint, the item keeps the closed sprint; `(sprint is EMPTY OR sprint not in openSprints())` finds it; starting a second sprint while one is active is 400; moving into a closed sprint is 400; the changelog has a `Sprint` item per move.
- [ ] **Step 2: Run** `node --test scripts/fake-jira-issues.test.mjs` → FAIL.
- [ ] **Step 3: Implement** the state, routes and JQL forms.
- [ ] **Step 4: Run** → PASS; `node --test scripts/lib/jira/` still PASS.
- [ ] **Step 5: Commit** `test: add sprints and the Agile routes to the fake Jira (PMK-78)`.

### Task 3: Read and filter an issue's sprint

**Files:**
- Modify: `scripts/lib/jira/issues.mjs` (`makeContext`, `ISSUE_FIELDS`, `toIssue`), `scripts/lib/jira/filter.mjs` (`sprint` handler, `STEP_ORDER`), `scripts/lib/jira/issue-ops.mjs` (`checkSearch`, `STEPS`, `searchIssues`), their tests.

**Interfaces:**
- Consumes: `sprintOf`, `readBoardSprints` (Task 1).
- Produces: `context.fields.sprint: string | null` (from `view.fields.sprint`), `context.boardId: number | null` (`raw.board?.type === 'scrum' ? raw.board.id : null`). `toIssue` sets `issue.sprint` (between `archived` and `due`, the model order) from `sprintOf(fields[context.fields.sprint], issue.status.category, context.boardId)`. `issueOperations({ client, getContext, now, sprints })` where `sprints(): Promise<JiraSprint[]>` is the board's sprints (tracker passes it in Task 5; tests pass a stub). `translateFilter(filter, context, { activeId })`.
- Filter rules: id → `sprint = "<id>"`; `current` → `activeId` ? `sprint = "<activeId>"` : `{ empty: true }`; `none` → `(sprint is EMPTY OR sprint not in openSprints())`; every sprint filter adds client step `sprint` (`issue.sprint === wanted`, or `undefined` for `none`). `checkSearch` passes `sprintExists: (id) => list.some((s) => String(s.id) === id)`; without a Scrum board or sprint field a sprint filter is `NOT_SUPPORTED` with the manifest hint.

- [ ] **Step 1: Write failing tests**: `issues.test.mjs` — an item with `customfield_10020: [closed41]` and status Done reads `sprint: '41'`; in progress reads no `sprint`. `filter.test.mjs` — the three clause forms above, `current` with no active id is `{ empty: true }`. `issue-ops.test.mjs` over the fake: `searchIssues({ sprint: 'none' })` returns the unfinished item of a closed sprint and the never-sprinted one; `{ sprint: 'current' }` with no active sprint is `[]`; `{ sprint: '999' }` is `INVALID_INPUT`.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/` → those FAIL.
- [ ] **Step 3: Implement.** Remove `sprint` from `LATER` reads only; writes stay refused until Task 4.
- [ ] **Step 4: Run** `node --test scripts/lib/jira/` → PASS.
- [ ] **Step 5: Commit** `feat: read and filter the sprint of a Jira work item (PMK-78)`.

### Task 4: Write an issue's sprint

**Files:**
- Modify: `scripts/lib/jira/issues.mjs` (`checkPatch`, new `planSprint`, `toFields(patch, before, context, { create, now, sprints })`), `scripts/lib/jira/issue-ops.mjs` (`createIssue`, `updateIssue`), tests.

**Interfaces:**
- Produces: `toFields(...)` result gains `sprint?: { to: string | null }` when the sprint changes. `planSprint` resolves `current` (none active: `INVALID_INPUT` "there is no active sprint", next step `pmkit cycle list`), an id or `none` (`unknownSprint(value)` from `../issue-filter.mjs`), a closed sprint (`closedSprint(id)`), `null` (leave). On create `null` is a no-op.
- `updateIssue`: after the field `PUT` and the branch property, `POST /rest/agile/1.0/sprint/{to}/issue` or `POST /rest/agile/1.0/backlog/issue` with `{ issues: [key] }`; a failure after another write is `UPSTREAM` "Jira updated <key>, but moving it to sprint <to> failed", next step `pmkit cycle add <key> --to <to|none>`. `createIssue`: the move after the create (before the status move); failure is `UPSTREAM` with `details.created`. Dry runs send nothing.

- [ ] **Step 1: Write failing tests** in `issue-ops.test.mjs`: create with `sprint: '1'` (active) puts it in the sprint and `getIssue` reads `'1'`; update to `null` sends `POST /backlog/issue`; update to a closed sprint is `CONFLICT` and `writes()` is unchanged; `current` with none active is `INVALID_INPUT`; dry run sends no write; an unchanged sprint sends no write.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Drop `sprint` from `LATER`.
- [ ] **Step 4: Run** `node --test scripts/lib/jira/` → PASS.
- [ ] **Step 5: Commit** `feat: move Jira work items into and out of sprints (PMK-78)`.

### Task 5: Cycle and capacity operations, tracker wiring, manifest

**Files:**
- Create: `scripts/lib/jira/cycle-ops.mjs`, `scripts/lib/jira/cycle-ops.test.mjs`
- Modify: `scripts/lib/jira/tracker.mjs`, `scripts/lib/jira/manifest.mjs` (+ test), `scripts/lib/jira/contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `entryFor, readCapacity, writeEntry` from `../capacity-store.mjs`; `stoppedHalfway` from `../cycle-moves.mjs`; `overlaps, addDays, validDate, SPRINT_STATES` from `../local/sprints.mjs`; `builtInDefaults().sprint_length_days`.
- Produces: `cycleOperations({ client, ops, config, getContext, now })` returning `{ listCycles, currentCycle, cycleIssues, openCycle, closeCycle, moveToCycle, getCapacity, getDaysOff, setCapacity, updateCycleCapacity }`, contract signatures as in `scripts/lib/github/cycle-ops.mjs`.
- `scope()`: `buildJiraCapabilities(raw, pmkit)` entry `cycles`; absent → `NOT_SUPPORTED` with its `enableHint`. Manifest: `SERVED` gains `cycles` and `capacity`; `cycles(raw, pmkit)` adds absent `No sprint field in space <key>` when `fieldRoles(raw, pmkit).fields.sprint` is null; drop `cycles`/`capacity` from `SERVED_IN`.
- `openCycle`: keys `start, end, goal, name`; Local's checks and messages (see `scripts/lib/local/tracker.mjs` `openCycle`); overlap only against dated planned/active sprints; `POST /sprint` then, when `start <= today` and none active, `POST /sprint/{id}` `{ state: 'active' }`; start failure → `UPSTREAM` "Jira created sprint <id>, but starting it failed: <message>", `details: { created: '<id>' }`, next step "Start the sprint on the board in Jira". Returns `{ before: null, after: toSprint(reread) }`; dry run `after.id === null`.
- `closeCycle(id)`: `NOT_FOUND` unknown; not active → `INVALID_INPUT` "sprint <id> is not active (it is <state>)"; unfinished = `cycleIssues(id)` outside `TERMINAL`, read first; `POST /sprint/{id}` `{ state: 'closed' }`; returns `{ sprint, unfinished, problems: [] }`; dry run `sprint.closed = now ISO`, sends nothing.
- `moveToCycle`: GitHub's order; `ops.updateIssue(id, { sprint }, actor, { dryRun })`; `// ponytail: one Agile move per issue; batch 50 keys per call if large scopes get slow`.
- Capacity: key `jira:<site>/<board id>`; members `context.view.members` ids; days off on a sprint with `start === null` → `INVALID_INPUT` "sprint <id> has no dates in Jira", next step "Set the sprint's dates in Jira".
- `tracker.mjs`: `issueOperations({ ..., sprints: () => readBoardSprints(client, boardId) })`; spread `cycleOperations(...)` through `guarded`.
- `contract.test.mjs`: families add `'cycles', 'cycle-lifecycle'`; setup's `today` stays `2026-11-22`.

- [ ] **Step 1: Write failing tests** in `cycle-ops.test.mjs` over the fake: open with `start: '2026-11-22'` sends create then start, state `active`; open with `start: '2026-12-07'` sends only the create, state `planned`, end `2026-12-20`; open overlapping the active sprint is `INVALID_INPUT` and sends nothing; a start refused by Jira (the test wraps the fake's `POST /rest/agile/1.0/sprint/{sprintId}` route to answer 400) gives `UPSTREAM` with `details.created`; close returns the unfinished issues and `closed`; close of a planned sprint is `INVALID_INPUT`; days off on an undated sprint is `INVALID_INPUT`; a Kanban-only board (`jiraSiteRoutes` override of `GET /rest/agile/1.0/board`) makes `listCycles` `NOT_SUPPORTED` with "Sprints need a Scrum board in space ENG". `manifest.test.mjs`: `cycles` `native`, `capacity` `derived`; no sprint field → `cycles` absent "No sprint field in space ENG". Contract families added.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test scripts/lib/jira/` and `npm test` → PASS (other tests that asserted cycles absent on Jira, such as `runbook-discover-jira.test.mjs` and its runbook text, are updated in this task).
- [ ] **Step 5: Commit** `feat: open, close and list Jira sprints, with capacity (PMK-78)`.

### Task 6: Sprint history events

**Files:**
- Modify: `scripts/lib/jira/history.mjs`, `scripts/lib/jira/history.test.mjs`, and `issues.mjs` `makeContext` already exposes `fields.sprint`.

**Interfaces:**
- Produces: in `changesOf`, a change whose `fieldId === context.fields.sprint` → `sprintChange(change)`: split `from`/`to` (ids, comma separated, trimmed); added = ids in `to` not in `from`; removed = ids in `from` not in `to`; event `['update', 'sprint', removed.at(-1) ?? (added.length ? from.at(-1) ?? null : null), added.at(-1) ?? null]`; no event when both are empty.

- [ ] **Step 1: Write failing tests**: `from '42, 43'`→`to '42'` gives `43 → null`; `'43'`→`'43, 44'` gives `43 → 44`; `''`→`'44'` gives `null → 44`; equal lists give no event.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/history.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: report Jira sprint changes as sprint history events (PMK-78)`.

### Task 7: Setup asks the sprint field

**Files:**
- Modify: `scripts/lib/jira/setup.mjs` (`FIELD_KEYS`, `FIELD_FITS`), `scripts/lib/jira/setup.test.mjs`, `commands/setup.md` (the Jira parameters paragraph names the sprint field), `docs/runbooks/setup-jira.md` and `scripts/runbook-setup-jira.test.mjs` if their outputs list the applied roles.

**Interfaces:**
- `FIELD_KEYS = ['estimate', 'acceptance_criteria', 'sprint']`; `FIELD_FITS.sprint = (field) => field.customType === 'com.pyxis.greenhopper.jira:gh-sprint'`. The fake site has one, so setup applies `mappings.fields.sprint: customfield_10020` with reason "the site offers only this field".

- [ ] **Step 1: Write failing test** in `setup.test.mjs`: a proposal on the fake raw applies `mappings.fields.sprint` = `customfield_10020`; a held file without the key gets it applied on `--update`.
- [ ] **Step 2: Run** `node --test scripts/lib/jira/setup.test.mjs` → FAIL.
- [ ] **Step 3: Implement** and update the docs text.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: setup maps the Jira sprint field (PMK-78)`.

### Task 8: Runbook, E2E test, changelog

**Files:**
- Create: `docs/runbooks/cycles-jira.md`, `scripts/runbook-cycles-jira.test.mjs` (launcher of `runbook-issues-jira.test.mjs`)
- Modify: `CHANGELOG.md` (Unreleased: Jira sprints), `commands/cycle/plan.md` and `commands/cycle/close.md` only where they name trackers that cannot open or close.

**Interfaces:**
- Runbook steps, each with the command and the expected output: `capabilities` (cycles native, capacity derived); `cycle open --start 2026-11-22 --goal "Ship sprints" --dry-run` then real (active); `cycle open --start 2026-12-07` (planned); `cycle list`; `issues create` ×2 and `cycle add <a> <b> --to <active id>`; `issues list --sprint current`; `cycle capacity <id> --set acc-1=8`; `issues move <b> done`; `cycle close <id> --dry-run` then real (unfinished lists `<a>`); `issues list --sprint none` lists `<a>`; `issues get <b>` keeps the closed sprint; a Kanban-only space `cycle list` → `NOT_SUPPORTED`. A "Skipped (no live Jira)" section lists: start/close on a real board, the behaviour of unfinished items after a REST close, the 12:00 UTC dates in the Jira UI, other-board sprints.
- The test asserts each step's JSON and that no output holds the token, email or header (as `runbook-issues-jira.test.mjs`).

- [ ] **Step 1: Write the runbook and the failing test** (it fails until the CLI text matches).
- [ ] **Step 2: Run** `node --test scripts/runbook-cycles-jira.test.mjs` → FAIL on the first mismatch, fix the test or the runbook text, not the product, unless the product is wrong.
- [ ] **Step 3: Run** `npm test` and `npm run lint` → PASS.
- [ ] **Step 4: Commit** `docs: add the Jira cycles runbook and its E2E test (PMK-78)`.
