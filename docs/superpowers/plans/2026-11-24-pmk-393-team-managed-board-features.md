# PMK-393 Team-managed board features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a team-managed Jira space, `cycles`, `estimation` and `releases` (and the board pmkit reads sprints from) follow the board's Sprints, Estimation and Releases features instead of the board type.

**Architecture:** Discovery reads `GET /rest/agile/1.0/board/{id}/features` as an optional read on a team-managed space with a board and stores `raw.board.features = { sprints, estimation, releases }`. One exported predicate `sprintsOn(raw)` replaces the three `board.type === 'scrum'` checks. The estimate role rule and the releases entry read the features directly.

**Tech Stack:** Node 18 ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-393-team-managed-board-features-design.md`

## Global Constraints

- Company-managed spaces keep today's behaviour exactly; `/features` is not called for them.
- Hints: cycles on team-managed `Turn on Sprints in space ${key}'s features`; releases `Turn on Releases in space ${key}'s features`; company-managed cycles hint stays `Sprints need a Scrum board in space ${key}`.
- UNREAD entry key `'board features'`, text `sprints, estimation and releases follow the board type`.
- A feature missing from Jira's answer reads as off. A mapped field (ADR 0014) still wins over the estimation feature.
- The live site host, email and token never enter the repository, test output or PR.
- Every commit message carries `(PMK-393)`.

## Review Focus

- Features read refused (403) on team-managed: discover warns, `features` absent, cycles falls back to type rules (absent with the Sprints-feature hint). Test in Task 1/2.
- Team-managed space with no board: no features read, no crash. Test in Task 1.
- Estimation off but a global `jsw-story-points` field and a board `estimationField` present: `estimate` null. Test in Task 1.
- A cached raw discovery from before this change (no `features`): behaves as before. Covered by `features` absent → type rules (Task 2 tests use rows without `features`).
- Sprint filter (`issues list --sprint current`) on a team-managed space with Sprints off: NOT_SUPPORTED with the Sprints-feature hint. Test in Task 3.

---

### Task 1: Discovery reads the board features

**Files:**
- Modify: `scripts/fake-jira-api.mjs` (`jiraSiteRoutes` gains `features = { sprints: true, estimation: true, releases: false }` used when `board === 'simple'`, serving `GET /rest/agile/1.0/board/1/features` as `{ features: [{ boardId: 1, feature: 'jsw.agility.sprints', state: 'ENABLED'|'DISABLED' }, ...estimation, releases, plus one unrelated 'jsw.agility.backlog' ENABLED] }`; the simple board's configuration gains `estimation: { type: 'field', field: { fieldId: 'customfield_10016' } }` only when `features.estimation`)
- Modify: `scripts/lib/jira/discovery.mjs`
- Test: `scripts/lib/jira/discovery.test.mjs`

**Interfaces:**
- Produces: `raw.board.features?: { sprints: boolean, estimation: boolean, releases: boolean }` (team-managed only, when read); `export const sprintsOn = (raw) => boolean`.

- [ ] **Step 1: Failing tests** in `discovery.test.mjs`:
  - `a team-managed board reads its Sprints, Estimation and Releases features`: `discover({ style: 'team-managed', board: 'simple' })` → `raw.board.features` deepEqual `{ sprints: true, estimation: true, releases: false }`; `sprintsOn(raw)` true.
  - `a company-managed space does not read board features`: `discover()` → `raw.board.features` undefined; no `/features` request in the fake's calls; `sprintsOn(raw)` true (scrum).
  - `a refused board features read warns and leaves the features out`: routes `{ 'GET /rest/agile/1.0/board/1/features': denied }` on team-managed simple → `raw.board.features` undefined; `view.warnings` includes `Jira refused to read the board features (AUTH); sprints, estimation and releases follow the board type`; `sprintsOn(raw)` false.
  - `estimation off leaves the estimate role empty, but a mapping still wins`: team-managed simple with `features: { sprints: true, estimation: false, releases: false }` → `view.fields.estimate` null; with `pmkit.mappings.fields.estimate: 'customfield_10016'` → `{ id: 'customfield_10016', ... }`.
  - `a team-managed space with no board reads no features`: existing empty-board route → `raw.board` null, no warning about board features.
  - Update `a team-managed simple board has no estimation field` to the new board shape (features present, estimationField per the features).
- [ ] **Step 2:** `node --test scripts/lib/jira/discovery.test.mjs` → the new tests FAIL.
- [ ] **Step 3:** Implement: `readFeatures(client, boardId)` → the three booleans from `features[].feature/state`; in `fetchDiscovery`, after `board`, when `styleOf(found) === 'team-managed' && board`, `const features = await optional(() => readFeatures(client, board.id), 'board features', unread)` and set `board.features` when not null; `UNREAD['board features']`; `sprintsOn`; `ROLE_RULES.estimate` returns undefined when `raw.board?.features?.estimation === false`.
- [ ] **Step 4:** `node --test scripts/lib/jira/discovery.test.mjs` → PASS.
- [ ] **Step 5:** Commit `fix: read a team-managed board's features in Jira discovery (PMK-393)`.

### Task 2: The manifest follows the features

**Files:**
- Modify: `scripts/lib/jira/manifest.mjs`
- Test: `scripts/lib/jira/manifest.test.mjs`

**Interfaces:**
- Consumes: `sprintsOn(raw)`, `raw.board.features`, `raw.space.style`.

- [ ] **Step 1: Failing tests** (raw rows built with `raw({ space: { key: 'ENG', type: 'software', style: 'team-managed' }, board: { id: 1, type: 'simple', estimationField: ..., features } })`):
  - `a team-managed simple board with Sprints on serves cycles`: cycles `{ path: 'native' }`, capacity derived.
  - `a team-managed board with Sprints off names the Sprints feature`: cycles `{ path: 'absent', enableHint: "Turn on Sprints in space ENG's features" }`; same hint when `features` is absent on a team-managed simple board.
  - `Releases off makes releases absent`: releases `{ id: 'releases', path: 'absent', enableHint: "Turn on Releases in space ENG's features" }`; Releases on → `native` with `{ entity: 'version' }`.
  - `Estimation off makes estimation absent`: features estimation false → estimation `absent` with `No estimate field in space ENG`.
  - The existing Kanban test keeps `Sprints need a Scrum board in space ENG` (company-managed).
- [ ] **Step 2:** `node --test scripts/lib/jira/manifest.test.mjs` → FAIL.
- [ ] **Step 3:** Implement in `cycles()` and `siteAnswers().releases`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `fix: Jira cycles and releases follow a team-managed board's features (PMK-393)`.

### Task 3: The sprint board in the issue context and the sprint filter

**Files:**
- Modify: `scripts/lib/jira/issues.mjs:50`, `scripts/lib/jira/filter.mjs:20-24`, comments in `scripts/lib/jira/cycle-ops.mjs:1` and `scripts/lib/jira/tracker.mjs:2` ("Scrum board" → "sprint board")
- Test: `scripts/lib/jira/filter.test.mjs` (or `issues.test.mjs`, whichever builds a context today)

**Interfaces:**
- Consumes: `sprintsOn(raw)`.

- [ ] **Step 1: Failing tests:** `makeContext` on a team-managed simple board with Sprints on has `boardId: 1`; Sprints off → null; `sprintUnsupported` on the latter gives `NOT_SUPPORTED` with message `Turn on Sprints in space ENG's features`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `boardId: sprintsOn(raw) ? raw.board.id : null`; `sprintUnsupported` picks the hint by `context.raw.space.style`. Export a shared `sprintHint(raw)` from `manifest.mjs` (used by `cycles()` and `filter.mjs`) so the wording lives once.
- [ ] **Step 4:** PASS; `npm test` green.
- [ ] **Step 5:** Commit `fix: a team-managed board with Sprints on is the Jira sprint board (PMK-393)`.

### Task 4: Runbooks (E2E on the fake)

**Files:**
- Modify: `docs/runbooks/cycles-jira.md`, `scripts/runbook-cycles-jira.test.mjs` (launcher env `PMKIT_FAKE_TEAM_MANAGED=sprints|off`: overrides `GET /rest/api/3/project/ENG` with `style: 'next-gen', simplified: true`, the board list with one `simple` board id 1, and `/board/1/features` with Sprints ENABLED or DISABLED)
- Modify: `docs/runbooks/discover-jira.md`, `scripts/runbook-discover-jira.test.mjs` (team-managed `capabilities`: `releases` absent with the Releases hint, `cycles` native)

- [ ] **Step 1:** Write the runbook steps, then the failing test steps: `cycle list --json` on team-managed with Sprints on exits 0 with the board's sprints; with Sprints off exits 2, `NOT_SUPPORTED`, nextStep `Turn on Sprints in space ENG's features`. Discover runbook: `capabilities --json` on team-managed simple gives the entries above.
- [ ] **Step 2:** FAIL before Tasks 1-3 are in (they are, so expect PASS once the launcher serves the routes; if the steps pass without the launcher change, the test is wrong).
- [ ] **Step 3:** PASS; the Failures table gains the Sprints-feature row.
- [ ] **Step 4:** Commit `test: team-managed sprint board in the Jira runbooks (PMK-393)`.

### Task 5: Live check on Kudos and CONTEXT

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs` (header comment; new test)
- Modify: `docs/superpowers/specs/2026-11-24-pmk-393-team-managed-board-features-design.md` ("Live results" section)

- [ ] **Step 1:** New test `a team-managed space's capabilities follow its board features` (skip on company-managed with a reason): read `/board/{id}/features` directly; assert `raw.board.features` equals the three states; cycles native iff Sprints (and the Sprint field) on, else absent with the feature hint; releases absent iff Releases off; estimation absent iff Estimation off and no mapping. Then in a `liveRepo` with `init --tracker jira --space SPACE` accepting the recommendations, `cycle list` answers (exit 0) when Sprints is on. Diagnostic line with the three states and the three paths.
- [ ] **Step 2:** Run `PMKIT_LIVE=1 PMKIT_LIVE_JIRA_SITE=<host> PMKIT_LIVE_JIRA_SPACE=KAN node --test scripts/lib/jira/client-live.mjs` with the credential loaded at runtime → all non-skipped tests PASS.
- [ ] **Step 3:** One-off probe (not committed as a test): record the current features; `PUT /rest/agile/1.0/board/1/features` Releases ENABLED → manifest `releases native` → Releases DISABLED; Estimation DISABLED → manifest `estimation absent`, board configuration's estimation recorded → Estimation ENABLED. Confirm Kudos ends Backlog, Sprints, Estimation on and Releases off; list site fields of types `gh-sprint`/`jsw-story-points` and any new ones before vs after.
- [ ] **Step 4:** Record the results in the design doc's "Live results"; commit `test: live check of team-managed board features (PMK-393)`.
