# Status change events on GHES 3.20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pmkit reads Status change events on GHES 3.20 and later, and keeps them off on 3.19.

**Architecture:** One threshold in `hostFeatures`; the fake GitHub gets its own schema fact for the events, so the 3.19 refusal is tested against the published schema and not against the adapter's belief.

**Tech Stack:** Node 18+ ES modules, `node:test`, the stateful fake GitHub; graphql-js only in a scratch folder for the one-off validation.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-350-ghes-3-20-status-events-design.md`

## Global Constraints

- No dependencies (ADR 0003); the schema validation runs outside the repository.
- Warning text: `on GitHub Enterprise Server before 3.20, Status option changes have no events, so moves show only as opens and closes`.
- Issue fields stay at 3.22; GHES 3.19 stays without Status events.

## Review Focus

- GHES `3.20.x` patch versions (`3.20.0`, `3.20.4`) turn the events on; `3.19.9` does not. Test in Task 1.
- An unknown GHES version (`ghesVersion: null` on a GHES host) keeps today's behavior (events on). Unchanged line; pinned by the existing `hostFeatures` test.

---

### Task 1: threshold, fake schema fact, warning text

**Files:**
- Modify: `scripts/lib/github/documents.mjs` (`hostFeatures` and its doc comment), `scripts/lib/github/history-ops.mjs` (`STATUS_WARNING` and the comment at line ~103), `scripts/fake-github-issues.mjs` (`statusEventsSchema` beside `repositoryIssueFields`, used in `schemaError` and the Status move at line ~429)
- Test: `scripts/lib/github/documents.test.mjs`, `scripts/fake-github-issues.test.mjs`, `scripts/lib/github/history-ops.test.mjs`, `scripts/cli-issues-github.test.mjs`

- [ ] **Step 1: Write the failing tests.**
  - `documents.test.mjs`: `hostFeatures({ host: 'git.acme.dev', ghesVersion: '3.20.0' }).statusEvents === true`, same for `3.20.4`, and `3.19.9` gives `false`.
  - `fake-github-issues.test.mjs`, new test `a GHES fake refuses the Status change event before 3.20 on its own schema fact`: on 3.19.0 `handle('PmkitTimeline', { itemTypes: ['PROJECT_V2_ITEM_STATUS_CHANGED_EVENT'] }, 'query PmkitTimeline { x }')` errors with `Variable $itemTypes ...`, and a query with `... on ProjectV2ItemStatusChangedEvent` errors with the fragment message; on 3.20.0 both answer with no error.
  - `history-ops.test.mjs`: the two "GHES 3.20 warns" tests move to `3.19.0`; new `getHistory on GHES 3.20 reads a Status change with no warning`: on `3.20.0`, create, move to in_progress, `getHistory` has a move to `In Progress`, no `warnings`, and the timeline read's `itemTypes` includes `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT`.
  - `cli-issues-github.test.mjs`: the "on GHES 3.20 ... print that Status changes have no events" test moves to `3.19.0`; the `STATUS_WARNING` constants in both test files say `before 3.20`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/documents.test.mjs scripts/fake-github-issues.test.mjs scripts/lib/github/history-ops.test.mjs scripts/cli-issues-github.test.mjs`. Expected: FAIL on the 3.20 cases and the warning text.
- [ ] **Step 3: Implement** the threshold `'3.20'`, the warning text, and `statusEventsSchema = !ghes || state.ghesVersion === null || compareVersions(state.ghesVersion, '3.20') >= 0` in the fake, replacing `features.statusEvents` in the two `schemaError` checks and in the Status move.
- [ ] **Step 4: Run** the same files: PASS. Then `npm test`, `npm run lint`: pass.
- [ ] **Step 5: Commit** `feat: read Status change events from GHES 3.20 (PMK-350)`.

### Task 2: ADR, runbook, changelog, schema validation

**Files:**
- Modify: `docs/adr/0007-github-issues-reuses-the-gh-login-and-needs-ghes-3-19.md` (dated amendment), `docs/runbooks/issues-github.md` (the history step's "before 3.21"), `CHANGELOG.md`, this design doc's "Validation" section
- Test: `scripts/adr-github-auth.test.mjs` (asserts `3.21` is in the ADR; the amendment keeps the old text and adds 3.20), `scripts/runbook-issues-github.test.mjs`

- [ ] **Step 1:** grep the runbook test and the ADR test for `3.21`; update any assertion on the history warning text first, run them: FAIL on the old runbook text.
- [ ] **Step 2:** Write the amendment ("## Amendment, 2026-11-21 (PMK-350)": the published GHES 3.20 schema has `ProjectV2ItemStatusChangedEvent` and the `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` timeline item type, 3.19 has neither; pmkit reads Status events from 3.20). Runbook line: before 3.20. Changelog line.
- [ ] **Step 3: Validate** (scratch folder, outside the repository): collect the `PmkitTimeline` and `PmkitMetricTimeline` (or whatever the history and metric reads are named) documents and variables the fake receives on 3.20 and 3.19 from the Task 1 tests, validate each with graphql-js 16 against `ghes-3.20` and `ghes-3.19` schemas from `github/docs`, record per document and schema in the design's "Validation".
- [ ] **Step 4: Run** the ADR and runbook tests, `npm test`, `npm run lint`: pass.
- [ ] **Step 5: Commit** `docs: ADR 0007 amendment, runbook and changelog for GHES 3.20 Status events (PMK-350)`.
