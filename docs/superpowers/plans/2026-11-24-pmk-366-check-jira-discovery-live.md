# PMK-366 Jira discovery live check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (small task, per AGENTS.md). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Field-role name rules match Jira's English `untranslatedName` on any site language, the fake shows the shapes a live site sends, and `client-live.mjs` checks discovery and the manifest live.

**Architecture:** One fix in `scripts/lib/jira/discovery.mjs` (`named()` and the raw field), one option in `jiraSiteRoutes`, new opt-in tests appended to `scripts/lib/jira/client-live.mjs`, a runbook step and note.

**Tech Stack:** Node 18+ ES modules, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-pmk-366-check-jira-discovery-live-design.md`

## Global Constraints

- No new dependency (ADR 0003). Only `credential.mjs` reads `JIRA_EMAIL` / `JIRA_API_TOKEN` (ADR 0013).
- The site host, the email, the token and account names never reach the repository, the PR, the issue or test output.
- Live writes only to the throwaway space; the new live tests are read-only.
- Existing `jiraSiteRoutes()` defaults unchanged, so no existing test moves.

## Review Focus

- A field with no `untranslatedName` (system fields, older sites): matching falls back to `name`. Test in Task 1.
- A site renamed custom field whose shown `name` is English but `untranslatedName` differs: still matched by `name`. Test in Task 1.
- `mappings.status` names: the site shows localized status names; mapping by the shown name keeps working (no change; runbook note in Task 3).
- Live test on a space without a board (business): the board shape check skips its board half. Task 2.
- A live failure message must not hold the host: diagnostics print counts and ids only. Task 2.

---

### Task 1: Match field names on `untranslatedName` (test-first)

**Files:**
- Modify: `scripts/fake-jira-api.mjs` (`jiraSiteRoutes({ locale })`)
- Modify: `scripts/lib/jira/discovery.mjs` (`fetchDiscovery` raw field, `named`)
- Test: `scripts/lib/jira/discovery.test.mjs`

**Interfaces:**
- Produces: raw field `{ id, name, untranslated: string|null, system, customType, type }`; `jiraSiteRoutes({ locale: 'pt' })` gives Portuguese field and status `name`s with `untranslatedName` English, statuses with `untranslatedName`; `jiraSiteRoutes({ board: 'simple' })` gives one `simple` board whose configuration has no `estimation`.

- [ ] **Step 1: Failing tests** in `discovery.test.mjs`:
  - `'name rules match the untranslated name on a site in another language'`: `discover({ routes: jiraSiteRoutes({ locale: 'pt' }) })` (with `discover` taking `locale`) → `view.fields.start_date` deep-equals `{ id: 'customfield_10015', name: 'Data de início' }`; with an extra `Critérios de aceite` / `Acceptance criteria` field, `acceptance_criteria.id` is that field; statuses keep their Portuguese names and categories.
  - `'name rules still match the shown name when there is no untranslated name'`: default routes → `start_date.id === 'customfield_10015'` (guards the fallback).
  - `'a team-managed simple board has no estimation field'`: `jiraSiteRoutes({ style: 'team-managed', board: 'simple' })` → `raw.board` deep-equals `{ id: 1, type: 'simple', estimationField: null }`.
- [ ] **Step 2:** `node --test scripts/lib/jira/discovery.test.mjs` → the pt test FAILS (`start_date` null).
- [ ] **Step 3:** keep `untranslated: field.untranslatedName ?? null`; `named` matches when `[field.untranslated, field.name]` lowercased contains one of the names.
- [ ] **Step 4:** run again → PASS; `npm test` → PASS.
- [ ] **Step 5:** commit `fix: match Jira field rules on the untranslated name (PMK-366)`.

### Task 2: Live discovery and manifest checks in `client-live.mjs`

**Files:**
- Modify: `scripts/lib/jira/client-live.mjs`

**Interfaces:**
- Consumes: `createJiraTracker(config, { env, now, fetch })` from `scripts/lib/jira/tracker.mjs` (`discover()`, `capabilities()`), the raw view on `view.raw`.

- [ ] **Step 1:** add, each skipped with its reason when its variable is unset:
  - `'discover the throwaway space'` (`PMKIT_LIVE_JIRA_SPACE`): `auth` is the first key; `space.style` equals `team-managed` iff project `style === 'next-gen' || simplified`; each work type level equals the `hierarchyLevel` mapping; each status category equals `categoryOfStatus(statusCategory.key)`.
  - `'the field-role rules find the site's fields'` (same): for each role with a field, the field satisfies its rule (system id, custom type, or untranslated name); for each `null` role, no site field satisfies the rule.
  - `'the license, configuration and board reads have the documented shapes'` (same): license `applications` array, `jira-software` plan in `FREE|PAID|UNLICENSED`; configuration `issueLinkingEnabled`, `subTasksEnabled` booleans; each board `type` in `scrum|kanban|simple`.
  - `'capabilities on the throwaway space'` (same): 20 entries, `plan.software` set.
  - `'discover a company-managed space'` (`PMKIT_LIVE_JIRA_COMPANY_SPACE`): `space.style === 'company-managed'`, plus the first two checks on it.
  - `'a token without admin rights discovers with warnings'` (`PMKIT_LIVE_JIRA_LIMITED_EMAIL`, `PMKIT_LIVE_JIRA_LIMITED_TOKEN`): `mypermissions` lacks `ADMINISTER`; `discover` resolves.
  Diagnostics: style, counts, role ids, plan; never names or the host.
- [ ] **Step 2:** `node --test scripts/lib/jira/client-live.mjs` without `PMKIT_LIVE` → every test skipped; `npm test` and `npm run lint` PASS.
- [ ] **Step 3:** run live on Kudos (see the file header) → the throwaway-space tests PASS, company/limited skip.
- [ ] **Step 4:** commit `test: opt-in live check of Jira discovery (PMK-366)`.

### Task 3: Runbook and record

**Files:**
- Modify: `docs/runbooks/discover-jira.md`, `scripts/runbook-discover-jira.test.mjs`, the design doc's Result section

- [ ] **Step 1: Failing runbook test** `'step 2 on a site in another language finds the start date field'`: launcher with `jiraSiteRoutes({ locale: 'pt' })` → `discover --json` `fields.start_date.id === 'customfield_10015'`; the runbook names it.
- [ ] **Step 2:** add the runbook line (names follow the site's language; rules match Jira's English name) and the live-check line; run → PASS.
- [ ] **Step 3:** record the live result table in the design doc; commit `docs: record the PMK-366 live result (PMK-366)`.
