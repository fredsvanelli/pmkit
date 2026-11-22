# PMK-259 Unarchive Issues On Linear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `issues unarchive` and `issues bulk unarchive` work on Linear for archived issues.

**Architecture:** `unarchive` in the Linear issue operations; the early CLI refusals kept for GitHub; the GitHub refusal's words updated.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-259-unarchive-issues-on-linear-design.md`

## Global Constraints

- No dependencies (ADR 0003). The words of the spec's refusals.

## Review Focus

- A trashed issue is refused before any mutation.
- `--dry-run` sends no mutation.

---

### Task 1: The adapter

**Files:** `scripts/lib/linear/issue-ops.mjs`, `scripts/lib/linear/tracker.mjs`; test `scripts/lib/linear/tracker.test.mjs`

- [ ] Replace the `NOT_SUPPORTED` test with: archive then `unarchive` brings ACME-1 back into `searchIssues({})`; a dry run sends no mutation; an issue not archived returns `before === after` with no mutation; a trashed issue rejects `{ code: 'INVALID_INPUT', nextStep: 'pmkit issues restore ACME-1' }` with no mutation. Red, implement, green, commit.

### Task 2: The CLI, the refusal and the docs

**Files:** `scripts/pmkit.mjs`, `scripts/lib/errors.mjs`, `commands/issues/bulk.md`, `commands/issues/update.md`, `README.md`, `docs/runbooks/issues-github.md`; tests `scripts/cli-bulk-linear.test.mjs`, `scripts/cli-issues-github.test.mjs`, `scripts/runbook-issues-github.test.mjs`, `scripts/lib/github/tracker.test.mjs`

- [ ] Replace the two Linear `NOT_SUPPORTED` bulk tests with `bulk unarchive on Linear previews the archived matches and brings them back`; the GitHub tests expect `unarchive works on the Local tracker and Linear, not on GitHub`. Red, implement, green. CHANGELOG. `npm test`, `npm run lint`. Commit.

### Task 3: Live

- [ ] A live probe: create, archive, unarchive one issue on the sandbox team; it is back and not archived. Run the live suite; the team is empty after.
