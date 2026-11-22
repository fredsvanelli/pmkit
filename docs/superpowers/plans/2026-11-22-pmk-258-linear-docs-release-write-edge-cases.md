# PMK-258 Linear Docs And Release Write Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each of the five edge cases reports what really happened.

**Architecture:** `storedDocPath` for comparing stored doc paths; a caught read-back in `updateIssue`; a two-slash `..` check; one command-file rule; release-notes entries with `releases`/`releaseUnknown`.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-258-linear-docs-release-write-edge-cases-design.md`

## Global Constraints

- No dependencies (ADR 0003). The words of notes and warnings are the spec's.

## Review Focus

- `--remove-doc docs/a.md` removes an attachment stored as `./docs/a.md`.
- A read-back failure that is not a `PmkitError` still throws.

---

### Task 1: Doc paths

**Files:** `scripts/lib/doc-path.mjs`, new `scripts/lib/doc-path.test.mjs`, `scripts/lib/linear/issue-ops.mjs`, `scripts/pmkit.mjs`; tests `scripts/lib/linear/tracker.test.mjs`, `scripts/cli-degraded.test.mjs`

**Produces:** `storedDocPath(path: string) -> string`.

- [ ] Tests: `repoDocPath('docs\\..\\..\\x.md')` throws `INVALID_INPUT` /leaves the repository/; `storedDocPath('./docs/a.md') === 'docs/a.md'`, `storedDocPath('../x') === '../x'`. Tracker: an issue with an attachment `pmkitDoc: './docs/a.md'`, `updateIssue({ docs: ['./docs/a.md', 'docs/b.md'] })` sends one `attachmentCreate` (b) and no `attachmentDelete`, `after.docs` holds both, and `takeNotes()` has `ACME-1 links docs/a.md as ./docs/a.md, written by another client; pmkit kept it as it is`. CLI: `--remove-doc docs/a.md` on that issue sends one `attachmentDelete`. Red.
- [ ] Implement. Green. Commit.

### Task 2: Read-back failure

**Files:** `scripts/lib/linear/issue-ops.mjs`, `scripts/pmkit.mjs`; test `scripts/cli-degraded.test.mjs`

- [ ] Test: the fake answers the second `PmkitIssueById` after the attachment create with `RATE_LIMITED`; `issues update ACME-1 --title T --add-doc docs/a.md --json` exits 0, `data.after.docs` is `['docs/a.md']`, and `warnings` holds `ACME-1 is updated and its docs are linked, but reading it back failed`. Red, implement, green, commit.

### Task 3: Record-decision and release notes

**Files:** `commands/spec/record-decision.md`, `scripts/lib/release-notes.mjs`; tests `scripts/scenarios.test.mjs` (static), `scripts/release-notes.test.mjs`

- [ ] Static test: step 6 of record-decision names `CONFLICT` and says to skip that issue's link and say so. `buildNotes` entries: an issue with `releases: [a, b]` has `releases` and no `release`; one with `releaseUnknown` has it and no `release`. Red, implement, green. CHANGELOG. `npm test`, `npm run lint`. Commit.
