# PMK-157 Validate Migrations And Skipped Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `validate` lists a missing migration and a failing version bump as `migration` problems, and says when and why it skipped the tracker files.

**Architecture:** `chain()` errors carry `details.migration`; `brokenConfigProblem` keys on that; the bump moves into the `try`; `validateRepo` returns `checked: null` and `skipped` on its early returns; the CLI text and `doctor.md` follow.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-157-validate-migrations-and-skipped-tracker-design.md`

## Global Constraints

- `validate` exits 0 with problems; it never throws for a tracker it can describe.

## Review Focus

- `migrate` (runMigrate) on a missing migration: still exits 2 with `NOT_SUPPORTED`, now with a next step.
- A hosted tracker with a broken `.pmkit/config.yaml`: `skipped` and the config problems together.
- Text with `checked: null`: no `checked:` line.

---

### Task 1: Migrations (red, green)

**Files:** `scripts/lib/local/migrations.mjs`, `scripts/lib/validate.mjs`, `scripts/migrations.test.mjs`

- [ ] Tests: `validateRepo(root, { migrations: [] })` on a format-1 tracker with format 2 current lists `{ code: 'migration', message: 'this pmkit has no migration from tracker format 1 toward format 2' }`; a step that deletes `config.yaml` gives `migration 1 to 2 failed: ...` with `details.migration` from `planMigration` and as a `validate` problem. Run: red.
- [ ] Implement `chain()` details and next step, `brokenConfigProblem` on `details.migration`, the bump inside the `try`. Run: green.

### Task 2: Skipped tracker (red, green)

**Files:** `scripts/lib/validate.mjs`, `scripts/pmkit.mjs` (`validate` text), `commands/local/doctor.md`, tests

- [ ] Tests: the three early returns give `checked: null` and their `skipped`; `pmkit validate` text starts with `tracker files not checked:`. Update the PMK-118 assertion of zero counts. Run: red.
- [ ] Implement; `doctor.md`; CHANGELOG; `npm test`; `npm run lint`; commit.
