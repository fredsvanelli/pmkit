# PMK-262 Cut The Extra Release And Docs Reads On Linear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No release or attachment read where pmkit already has the answer or never shows it.

**Architecture:** `readNode(id, { extras })`, `keep(node, from, { releases, docs })`, attach after search filtering, one `attachInBatches` helper.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-262-cut-extra-linear-release-docs-reads-design.md`

## Global Constraints

- No dependencies (ADR 0003). Every command's output stays as the existing tests and goldens check it.

## Review Focus

- A release write (`--release`) still reads the releases after its write.
- A docs write still reads the attachments after its write.
- An unread list carried over stays unread, never empty.

---

### Task 1: Request-count tests

**Files:** `scripts/lib/linear/tracker.test.mjs`

- [ ] A helper `listReads(fetch, from = 0)` counts `PmkitIssuesReleases`, `PmkitIssueReleases`, `PmkitIssuesAttachments`, `PmkitIssueAttachments` from call index `from`. Tests, each on a releases-on setup with a seeded issue:
  - `a write that touches neither releases nor docs reads neither after it`: for `updateIssue({ priority })`, `moveToCategory`, `assign`, `archive`, `link`: `listReads` from the mutation's index is 0.
  - `history, comments, delete and a parent lookup read no release or attachment`: `getHistory`, `listComments`, `deleteIssue` (dry run), `createIssue({ parent: 'ACME-1' }, { dryRun: true })`: `listReads` 0.
  - `a bulk change reads each issue's lists once, before its write`: bulk builder `parseChange('priority', 'high')` applied to 3 issues: 3 release and 3 attachment batch reads in all.
  - `a search reads the lists of the issues it keeps only`: `searchIssues({ limit: 1 })` over 3 issues: the batch read's `ids` has 1 id.
  - `a release write reads the releases again after it` and `a docs write reads the attachments again after it`.
- [ ] Run: red on all but the last two.

### Task 2: The cuts

**Files:** `scripts/lib/linear/issue-ops.mjs`, `history-ops.mjs`, `relation-ops.mjs`

- [ ] `readNode` `extras`, `keep`, `changesReleases(input)`, the callers of the spec, search attaching after `finishSearch`. Green. Commit.

### Task 3: One batch helper

- [ ] Test `one issue whose release page read fails is unknown, and the rest of its chunk keeps its releases`: red. `attachInBatches` for both lists; green. CHANGELOG; `npm test`, `npm run lint`. Commit.
