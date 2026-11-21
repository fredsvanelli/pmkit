# Read sprint issues faster on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `cycle issues` reads one sprint's Project items on github.com and GHE.com instead of scanning the repository, and `cycle add` reads each issue once before its write.

**Architecture:** A new `SPRINT_ITEMS` document over `ProjectV2.items(query:)`, gated by a new `itemQuery` host feature; `issueOperations` gains `sprintIssues`; `updateIssue` takes an optional pre-read node.

**Tech Stack:** Node 18+ ES modules, `node:test`, the stateful fake GitHub.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-344-sprint-issues-faster-design.md`

## Global Constraints

- No dependencies (ADR 0003).
- `cycle issues` output unchanged: same issues, same shape, created order (oldest first), no archived item, no other repository, no draft or pull request.
- Query text: `is:issue repo:<owner/name> <qualifier>:"<iteration title>"`, where `<qualifier>` is the iteration field's name in lower case. The scan stays when the host has no `itemQuery`, when the title holds `"`, or when the field name holds a space or `"` (`// ponytail:` the Project filter syntax is not checked live yet, PMK-351).
- `hostFeatures(...).itemQuery`: true on github.com and GHE.com, false on GHES (any version).

## Review Focus

- The same id twice in `cycle add`: the second write must plan from a fresh read, not the first read (Task 2 test).
- Two iterations sharing a title: the query returns both; the client step keeps only the asked sprint (Task 1 test).
- A sprint id that is a date no iteration has: `[]` and no items read (Task 1 test).
- The discovery cache has no iteration for the id (a sprint added on GitHub after the cache): falls back to the scan, which refreshes (Task 1 test).

---

### Task 1: `cycle issues` through `items(query:)`

**Files:**
- Modify: `scripts/lib/github/documents.mjs` (`hostFeatures` gains `itemQuery`; `SPRINT_ITEMS` document), `scripts/lib/github/issue-ops.mjs` (`sprintIssues`), `scripts/lib/github/cycle-ops.mjs` (`cycleIssues`), `scripts/fake-github-issues.mjs` (route `PmkitSprintItems`; schema fact: GHES 3.19 has no `items(query:)`)
- Test: `scripts/lib/github/cycle-ops.test.mjs`, `scripts/lib/github/documents.test.mjs`, `scripts/fake-github-issues.test.mjs`

**Interfaces:**
- Produces: `SPRINT_ITEMS` = `query PmkitSprintItems($project: ID!, $first: Int!, $after: String, $query: String!, <field vars>) { node(id: $project) { ... on ProjectV2 { items(first: $first, after: $after, query: $query) { nodes { content { __typename ... on Issue { ...PmkitIssueFields } } } pageInfo } } } }`; `ops.sprintIssues({ id, name }, fieldName) → Promise<Issue[]>`.

- [ ] **Step 1: Write the failing tests.**
  - `documents.test.mjs`: `hostFeatures` deep-equals gain `itemQuery: true` on github.com and GHE.com, `false` on every GHES version.
  - `cycle-ops.test.mjs`, `cycleIssues on github.com reads the sprint's Project items, not the repository`: seed #1 (Sprint 2), #2 (Sprint 1), #3 (no sprint), #4 (Sprint 2, archived item), a pull request item; `cycleIssues('2026-11-16')` gives `['1']`; `fake.reads` names include `PmkitSprintItems` and not `PmkitIssues`; its `query` variable is `is:issue repo:acme/widgets sprint:"Sprint 2"`.
  - `cycleIssues keeps only the asked sprint when two iterations share a title`: iterations with titles `Sprint` and `Sprint`; only the asked start date's issue.
  - `cycleIssues on GHES scans the repository`: `ghesVersion: '3.20.0'`, reads `PmkitIssues`, no `PmkitSprintItems`; same result.
  - `cycleIssues of a title with a quote scans`: iteration titled `Sprint "2"`; reads `PmkitIssues`.
  - The existing `cycleIssues returns the issues of an iteration, and nothing for an unknown date` keeps passing, and for `2027-01-04` sends no `PmkitSprintItems`.
  - `fake-github-issues.test.mjs`: a GHES 3.19 fake refuses `items(first: 1, query: "x")` with `Unknown argument 'query' on field 'ProjectV2.items'`.
- [ ] **Step 2: Run** `node --test scripts/lib/github/cycle-ops.test.mjs scripts/lib/github/documents.test.mjs scripts/fake-github-issues.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Fake route: items of the project, not archived, content an issue of the `repo:` repository, whose iteration (by the field named by the qualifier) has the quoted title; answer with `issueNode` content and `__typename: 'Issue'`. `sprintIssues`: paginate `SPRINT_ITEMS` with `stop` completing (`completeNested`) and mapping (`toIssueWithWarnings`) each issue, keep `issue.sprint === sprint.id`, sort with `issueComparator('created', context.priorities)`. `cycleIssues`: find the sprint in `sprintsOf(field.configuration, today())` from the cached context; use `sprintIssues` when `context.features.itemQuery`, the sprint is found, and title and field name are quotable; else `ops.searchIssues({ sprint: id })`.
- [ ] **Step 4: Run** the same files: PASS; `npm test`, `npm run lint`: pass.
- [ ] **Step 5: Commit** `feat: cycle issues reads the sprint's Project items on github.com (PMK-344)`.

### Task 2: `cycle add` reads each issue once

**Files:**
- Modify: `scripts/lib/github/issue-ops.mjs` (`updateIssue` option `read`), `scripts/lib/github/cycle-ops.mjs` (`moveToCycle`)
- Test: `scripts/lib/github/cycle-ops.test.mjs`

**Interfaces:**
- Produces: `ops.updateIssue(id, patch, actor, { dryRun, base, read })`, `read` = `{ node, issue }` from `ops.readNode(id)`.

- [ ] **Step 1: Write the failing tests.**
  - `moveToCycle reads each issue once before its write`: seed #1 and #2, `clear()`, `moveToCycle(['1', '2'], '2026-11-16', ME)`; the `PmkitIssue` reads before the first mutation number 2 (today 4).
  - `moveToCycle of the same id twice plans the second write from a fresh read`: `moveToCycle(['1', '1'], '2026-11-16', ME)`; the second result's `before.sprint` is `'2026-11-16'` and only one `PmkitSetProjectField` mutation is sent.
- [ ] **Step 2: Run** `node --test scripts/lib/github/cycle-ops.test.mjs`: the first FAILS (4 reads); the second passes today (pins the behavior).
- [ ] **Step 3: Implement** `read` in `updateIssue` (`read ?? await readNode(id)`), and in `moveToCycle` a `Map` of the check loop's reads, each taken once (`get`, then `delete`), so a repeated id reads again.
- [ ] **Step 4: Run** the file, `npm test`, `npm run lint`: pass.
- [ ] **Step 5: Commit** `perf: cycle add reads each issue once before its write (PMK-344)`.

### Task 3: E2E, docs

**Files:**
- Modify: `scripts/runbook-cycles-epics-github.test.mjs` (assert `cycle issues` sent `PmkitSprintItems`), `docs/runbooks/cycles-epics-github.md` (the `cycle issues` step says it reads the sprint's Project items on github.com), `CHANGELOG.md`

- [ ] **Step 1:** Add the assertion to the runbook test (the fake `gh` log holds the operation name); run it: PASS once Task 1 is in (it would FAIL on develop).
- [ ] **Step 2:** Runbook sentence and changelog line.
- [ ] **Step 3: Run** the runbook test, `npm test`, `npm run lint`: pass.
- [ ] **Step 4: Commit** `docs: cycle issues reads Project items on github.com, in the runbook and changelog (PMK-344)`.
