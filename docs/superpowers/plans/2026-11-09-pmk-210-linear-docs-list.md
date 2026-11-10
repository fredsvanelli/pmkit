# PMK-210: `listDocuments` on Linear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs list` works on the Linear adapter, the contract suite pins `listDocuments`, and the design spec's operations table lists it.

**Architecture:** Linear's `listDocuments` follows `listMilestones`: read the projects accessible to `scope.team`, page through all documents, keep those whose project is in that set, return `{ path: slugId, title }` sorted by `path`. A page cap (`hasMore`) is an error, never a silent partial list.

**Tech Stack:** Node ESM, `node:test`, the in-memory project fake (`scripts/fake-linear-api.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-210-linear-docs-list-design.md`

## Global Constraints

- Commit messages carry `(PMK-210)` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `documents` stays `path: native` in the Linear manifest; ADR-0001 counts do not change.
- `createDocument` stays `NOT_SUPPORTED` on Linear.
- A read that may be incomplete (`hasMore`) is reported as an error (`UPSTREAM`), not a short list.
- `npm test` runs in the foreground and exits 0 before the PR opens.

## Review Focus

- A document of a project outside `scope.team` must not be listed (test in Task 2).
- A workspace with no documents returns `[]`, not an error (Task 2).
- More documents than the page cap allows fails with `UPSTREAM` and a next step, never a truncated list (Task 2).
- A broken mapping still stops `listDocuments` through `guarded` (Task 3).
- The contract case must pass on Local (no `title`) and on Linear (with `title`): assert only `path` (Task 4).

---

### Task 1: Query and fake route

**Files:**
- Modify: `scripts/lib/linear/projects.mjs` (next to `DOCUMENT_QUERY`), `scripts/fake-linear-api.mjs` (project fake, next to `PmkitDocument`)

**Interfaces:**
- Produces: `export const DOCUMENTS_QUERY` (operation `PmkitDocuments($first: Int!, $after: String)`, `documents(first, after) { nodes { slugId title project { id } } pageInfo }`); the fake answers `PmkitDocuments` with paged `documents` connection built from seeded documents.

- [ ] **Step 1: Add `DOCUMENTS_QUERY`** beside `DOCUMENT_QUERY`, using the file's `PAGE_INFO` fragment.
- [ ] **Step 2: Route `PmkitDocuments` in the fake** with `connection(nodes, first, after)` as `PmkitProjectMilestones` does; node `{ slugId, title, project: { id } }`.
- [ ] **Step 3: Run** `node --test scripts/lib/linear/project-ops.test.mjs` and expect PASS (no behavior change yet).
- [ ] **Step 4: Commit** `feat(linear): add the documents list query and fake route (PMK-210)`.

### Task 2: `listDocuments` operation

**Files:**
- Modify: `scripts/lib/linear/project-ops.mjs` (new `listDocuments`, export in the returned object), `scripts/lib/linear/project-ops.test.mjs`

**Interfaces:**
- Consumes: `DOCUMENTS_QUERY`, `PROJECTS_QUERY`, `scope.team`, `requireWorkspace`.
- Produces: `listDocuments(): Promise<Array<{ path: string, title: string }>>`.

- [ ] **Step 1: Write the failing tests** in `project-ops.test.mjs`:
  - `listDocuments returns path and title sorted by slug, for the team's projects only`: seed two projects (one on another team, as the milestone tests do), documents `bbbbbbbbbbbb`/`aaaaaaaaaaaa` on the team project and `cccccccccccc` on the other; expect `[{ path: 'aaaaaaaaaaaa', title: ... }, { path: 'bbbbbbbbbbbb', ... }]`.
  - `listDocuments returns an empty list when there are no documents`.
  - `listDocuments fails with UPSTREAM and a next step when the pages exceed the cap`: seed more than `maxPages * LIST_PAGE` documents (or build the kit with a small cap) and `assert.rejects(..., { code: 'UPSTREAM' })` with a non-empty `nextStep`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/project-ops.test.mjs`; expect FAIL (`listDocuments is not a function`).
- [ ] **Step 3: Implement** `async function listDocuments()`: `requireWorkspace()`, project ids as `listMilestones` does, `client.paginate(DOCUMENTS_QUERY, {}, { select: (data) => data.documents, pageSize: LIST_PAGE, maxPages: 100 })`; throw `PmkitError('UPSTREAM', 'Linear has more documents than pmkit reads in one list', 'pmkit docs read <slug> reads one document')` when `hasMore`; filter by project id; map to `{ path: slugId, title }`; sort by `path` with `<`/`>`.
- [ ] **Step 4: Run** the same test file; expect PASS.
- [ ] **Step 5: Commit** `feat(linear): list the project documents (PMK-210)`.

### Task 3: Wire it and fix the manifest

**Files:**
- Modify: `scripts/lib/linear/tracker.mjs` (after `readDocument`), `scripts/lib/linear/manifest.mjs:23`, `scripts/lib/linear/manifest.test.mjs:91`, `scripts/lib/linear/tracker.test.mjs` (`PROJECT_OPERATIONS`)

**Interfaces:**
- Consumes: `projects.listDocuments`.
- Produces: `tracker.listDocuments()`; manifest `documents.detail` = `{ scope: 'project', unsupported: ['createDocument'] }`.

- [ ] **Step 1: Failing tests**: `listDocuments: []` in `PROJECT_OPERATIONS` (so the implemented and guarded checks cover it); manifest test expects `unsupported: ['createDocument']`.
- [ ] **Step 2: Run** `node --test scripts/lib/linear/tracker.test.mjs scripts/lib/linear/manifest.test.mjs`; expect FAIL.
- [ ] **Step 3: Wire** `listDocuments: projects.listDocuments` in `tracker.mjs` and update the manifest line. Confirm `SERVED_BY` and ADR-0001 need no change.
- [ ] **Step 4: Run** the same files; expect PASS.
- [ ] **Step 5: Commit** `feat(linear): serve listDocuments and drop it from the unsupported list (PMK-210)`.

### Task 4: Contract case and live probe

**Files:**
- Modify: `scripts/contract-suite.mjs` (after the document cases, ~line 520), `scripts/lib/linear/client-live.mjs` (~line 223)

**Interfaces:**
- Consumes: `tracker.listDocuments()`, `tracker.createDocument`.

- [ ] **Step 1: Add case** `lists documents with a path each, sorted` in family `['documents']`: array, every item `typeof path === 'string'`, paths equal to a sorted copy, `DOC_PATH` absent.
- [ ] **Step 2: Add case** `lists a created document` in `['documents', 'document-writes']`: after `createDocument(DOC_PATH, ...)`, `listDocuments()` has an item with `path === DOC_PATH`.
- [ ] **Step 3: Add** `assert.ok(Array.isArray(await adapter.listDocuments()))` beside `listMilestones` in `client-live.mjs` (read only, not run here).
- [ ] **Step 4: Run** `node --test scripts/contract.test.mjs scripts/lib/linear/contract.test.mjs` (use the real file names found with `ls scripts/*contract*`); expect PASS for Local and the Linear fake, and fix the family counts those tests pin.
- [ ] **Step 5: Commit** `test(contract): pin listDocuments (PMK-210)`.

### Task 5: Docs, acceptance, verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-pmkit-design.md:104`, `CHANGELOG.md` (top of `## Unreleased`), `README.md:129`

- [ ] **Step 1:** Documents row becomes `readDocument(path)`, `createDocument(path, body, actor)`, `listDocuments()`.
- [ ] **Step 2:** CHANGELOG line in the style of the others: `- Improves `docs list` (PMK-210). ...`; README row: say it works on Local and Linear.
- [ ] **Step 3:** `node scripts/pmkit.mjs issues update PMK-210 --check 1` (and 2, 3), dry run then real; commit `.issues/`.
- [ ] **Step 4:** Run `npm test` in the foreground (long timeout); expect exit code 0 (check `$?`, not only the failure count).
- [ ] **Step 5: Commit** `docs: record listDocuments on Linear (PMK-210)`.
