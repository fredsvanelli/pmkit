# PMK-266 Tidy The Linear Release, Docs And Archive Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The seven review cleanups, with no change to any command's output except `release list` without a scope team.

**Architecture:** One small edit per point; the existing tests and goldens hold the output.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-266-tidy-linear-release-docs-archive-design.md`

## Global Constraints

- No dependencies (ADR 0003). `npm test` passes with no golden change.

## Review Focus

- `release get` with no scope team answers `NOT_CONFIGURED` too, before any request.
- `--add-doc` with `--remove-doc` in one call still prints the default-branch note.

---

### Task 1: Release reads need the scope team

**Files:** `scripts/lib/linear/releases.mjs`; test `scripts/lib/linear/tracker.test.mjs`

- [ ] Test `release list and release get on Linear without tracker.scope.team answer NOT_CONFIGURED before any request`: `listReleases()` and `getRelease(<uuid>)` reject `{ code: 'NOT_CONFIGURED' }`, and the fake saw no `PmkitReleases` or `PmkitRelease`. Red, then implement, green, commit.

### Task 2: Release query and figures

**Files:** `scripts/lib/linear/documents.mjs`, `scripts/fake-linear-api.mjs`, `scripts/lib/linear/API-VERIFICATION.md`, `scripts/lib/linear/tracker.test.mjs`

**Produces:** `releases.mjs` export `activeReleases(nodes) -> nodes` (stage type not `canceled`).

- [ ] Test `RELEASE_QUERY reads the pipeline teams and the shared release fields`: it includes `pipeline { id teams(first: 250) { nodes { key } } }` and every field of the list selection but `pipeline { id }`. Test `the fake pages an issue's releases in the batch read by BATCH_RELEASES_PAGE`: an issue with 21 releases comes back from `PmkitIssuesReleases` with 20 and `hasNextPage`. Red.
- [ ] Shared base fields, no `.replace`; fake uses `BATCH_RELEASES_PAGE`; figures 20 / 4,650 in the notes and comments; `activeReleases` used in `releases.mjs`, `writes.mjs`, `issue-ops.mjs`. Green, commit.

### Task 3: One cut-off warning, one doc-branch read, one archive

**Files:** `scripts/lib/release-notes.mjs`, `scripts/lib/format.mjs`, `scripts/pmkit.mjs`, `scripts/lib/linear/issue-ops.mjs`, `scripts/lib/local/tracker.mjs`, `scripts/lib/bulk.mjs`; test `scripts/cli-linear.test.mjs`

- [ ] Test `issues update --remove-doc alone on Linear prints no default-branch note`: with `default_branch` unset and an `origin/HEAD`, `--remove-doc` gives no `notes`; `--add-doc` gives the note. Red.
- [ ] `NOTES_CUT` exported from `release-notes.mjs`; resolve the branch once, only for `--add-doc`; `docUrl` comment; `setArchived` and the bulk helper. Green. CHANGELOG. `npm test`, `npm run lint`. Commit.
