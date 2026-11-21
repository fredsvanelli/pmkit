# Open review findings of the GitHub sprint and epic code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four PMK-88 review findings with no behavior change.

**Architecture:** A file move, two pinning tests, one fix in `withRefresh`, and helper extractions in nine functions.

**Tech Stack:** Node 18+ ES modules, `node:test`, ESLint 10.15.0 through `npx` for the complexity measure.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-345-github-sprint-epic-review-findings-design.md`

## Global Constraints

- No behavior change except the stale detail; the existing tests are the net, and `npm test` stays green after each task.
- Complexity measure: `npx --yes eslint@10.15.0 --no-config-lookup --rule '{"complexity":["warn",10]}' -f json <files>`; each of the nine functions reports nothing.
- `searchIssues` and `fieldValue` stay as they are; PMK-336 lists both.

## Review Focus

- The stale error after the refresh keeps its code, message and next step; only `details.stale` goes (Task 3).
- A split that moves a guard after a read would change what a bad input costs (a request before the refusal). Each split keeps the order of checks (Task 4: the existing "before any request" tests).

---

### Task 1: capacity store in `scripts/lib/`

**Files:** `git mv scripts/lib/linear/capacity-store.mjs scripts/lib/capacity-store.mjs` and its test; imports in `scripts/lib/linear/cycle-ops.mjs`, `scripts/lib/linear/manifest.mjs`, `scripts/lib/github/cycle-ops.mjs`, `scripts/lib/github/manifest.mjs`, and the test's own imports.

- [ ] **Step 1:** Move both files, fix the imports (`../capacity-store.mjs` from an adapter, `./...` paths inside the moved test).
- [ ] **Step 2: Run** `node --test scripts/lib/capacity-store.test.mjs scripts/lib/linear/*.test.mjs scripts/lib/github/*.test.mjs` and `git grep -n "linear/capacity-store"`. Expected: PASS, and no reference left.
- [ ] **Step 3: Commit** `refactor: move the capacity store to scripts/lib, shared by both adapters (PMK-345)`.

### Task 2: `classifyRest` tests

**Files:** Test: `scripts/lib/github/client.test.mjs`

- [ ] **Step 1:** `rest GET with an unreadable 2xx body is UPSTREAM and not retried`: the exec answers `HTTP/2.0 200 OK\r\n\r\nnot json` to `client.rest('GET', 'repos/acme/widgets')`; reject with `code: 'UPSTREAM'`, message `GitHub returned an unreadable answer (HTTP 200)`, and one exec call.
- [ ] **Step 2:** `rest already_exists off /milestones is UPSTREAM with GitHub's message, not CONFLICT`: a 422 with `{"message":"Validation Failed","errors":[{"code":"already_exists"}]}` to `client.rest('POST', 'repos/acme/widgets/labels', { name: 'x' })`; `code: 'UPSTREAM'`, message starts `GitHub answered with an error:`.
- [ ] **Step 3: Run** `node --test scripts/lib/github/client.test.mjs`. Expected: PASS (they pin existing behavior; check each fails when its branch in `classifyRest` is broken by hand, then restore).
- [ ] **Step 4: Commit** `test: classifyRest on an unreadable GET answer and already_exists off milestones (PMK-345)`.

### Task 3: no stale detail after the refresh

**Files:** Modify `scripts/lib/github/issue-ops.mjs` (`withRefresh`). Test: `scripts/lib/github/cycle-ops.test.mjs` (the test `searchIssues --sprint current with no active sprint after the refresh answers INVALID_INPUT, after one refresh`).

- [ ] **Step 1:** In that test, also assert `error.details?.stale === undefined`.
- [ ] **Step 2: Run** it. Expected: FAIL (`stale: true`).
- [ ] **Step 3:** `withRefresh`: when the second build throws a `PmkitError` whose `details.stale` is true, throw `new PmkitError(code, message, nextStep, rest)` with `stale` removed (`rest` undefined when empty).
- [ ] **Step 4: Run** the file: PASS. **Commit** `fix: the stale hint does not leave withRefresh (PMK-345)`.

### Task 4: split the nine functions

**Files:** `scripts/lib/github/client.mjs` (`classifyRest`), `scripts/lib/github/cycle-ops.mjs` (`openCycle`, `moveToCycle`), `scripts/lib/github/issues.mjs` (`toIssueWithWarnings`), `scripts/lib/github/mappings.mjs` (`problemOf`), `scripts/lib/github/project-ops.mjs` (`bodyOf`, `epicInput`, `createDeliverable`), `scripts/lib/github/writes.mjs` (`applyPlan`).

- [ ] **Step 1:** For each function, extract named helpers for its separable concerns (a guard block, a per-group branch, an optional-field block), keeping the order of every check and request. One commit per file: `refactor: split <function> under complexity 10 (PMK-345)`.
- [ ] **Step 2: Run** after each file: that file's tests, then the complexity measure on it. Expected: PASS and no report for the split function.
- [ ] **Step 3: Run** `npm test` and `npm run lint` at the end. Expected: pass.
