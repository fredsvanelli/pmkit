# PMK-156 Setup And Doctor Failing Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Doctor and setup read a `migration` problem by its code, setup step 2 says which codes make `init --update` refuse, and the unsupported-tracker advice never leaves the repository without a tracker.

**Architecture:** Command-file text only, pinned by static tests in `scripts/scenarios.test.mjs`.

**Tech Stack:** Markdown command files, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-156-setup-and-doctor-failing-migration-design.md`

## Global Constraints

- No CLI change. The scenario harness keeps parsing both files (step ids unchanged).

## Review Focus

- Doctor step 3 order: `config`, `FORMAT`, `migration`, each stopping before the CLI fixes.
- Setup step 2 for the hosted sections stays as it is (they have no tracker files).

---

### Task 1: Static tests (red), then the text (green)

- [ ] Tests: `local/doctor step 3 settles migration problems before any fix` (the bullet names `/pmkit:upgrade` for a missing migration, shows the reason of a failing step, and stops while one remains); `local/doctor step 3 checks the tracker folder before setting tracker.system to local`; `setup Existing config step 2 reads the problems by code` (`config` or `conflict` refuse, `FORMAT` and `migration` do not stop the update). Run: red.
- [ ] Edit `commands/local/doctor.md` step 3 and `commands/setup.md` "Existing config" step 2. Run: green; scenarios unchanged.
- [ ] CHANGELOG; `npm test`; `npm run lint`; commit.
