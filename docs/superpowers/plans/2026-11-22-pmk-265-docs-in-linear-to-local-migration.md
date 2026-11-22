# PMK-265 Docs In The Linear-To-Local Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `local-migrate import` brings each Linear issue's docs into its Local issue, and the preview counts them.

**Architecture:** Attachments read in the snapshot; `docs` through `mapImport` and the Local writer; a count on the preview's source line.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-265-docs-in-linear-to-local-migration-design.md`

## Global Constraints

- No dependencies (ADR 0003). A failed read fails the snapshot.

## Review Focus

- An attachment pmkit did not create is neither carried nor counted.
- An archived issue keeps its docs.

---

### Task 1: Snapshot and mapping

**Files:** `scripts/lib/linear/migrate-reader.mjs`, `scripts/lib/local/migrate-fields.mjs`; tests `scripts/lib/linear/migrate-reader.test.mjs`, `scripts/lib/local/migrate-fields.test.mjs`

- [ ] Tests: the snapshot issue has `docs: ['docs/a.md']` from a pmkit attachment and none from a hand-made one; an issue with more attachments than one batch page has all its docs; `mapImport` puts `docs` in the issue fields. Red, implement, green, commit.

### Task 2: Writer and preview

**Files:** `scripts/lib/local/migrate-writer.mjs`, `scripts/lib/migrate/cli.mjs`; test `scripts/cli-migrate.test.mjs`

- [ ] Test: an import of a team whose issue has a pmkit doc writes `docs: [docs/a.md]` in the Local issue file, and the dry run's `source:` line says `1 doc`. Red, implement, green. CHANGELOG. `npm test`, `npm run lint`. Commit.
