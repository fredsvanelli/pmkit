# PMK-261 Create And Mark Linear Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `release create`, `release mark-released` and `issues create --release` on Linear. **Spec:** `docs/superpowers/specs/2026-11-22-pmk-261-create-and-mark-linear-releases-design.md`

## Global Constraints
- No dependencies (ADR 0003). Releases off keeps the manifest's refusal.

## Review Focus
- `--tag` refused on both commands; a second pipeline refused with names.

### Task 1: Release writes
- [ ] Tests (`tracker.test.mjs`): create prints the planned record and lists; dry run sends no mutation; duplicate version CONFLICT; tag refused; two pipelines refused. Mark: released record; CONFLICT when released; get shows released. Red, implement, green, commit.

### Task 2: issues create --release, manifest, docs
- [ ] Tests: create with release has it; dry run shows it; releases off refuses all three. Red, implement, green. CHANGELOG, README, verification notes. `npm test`, `npm run lint`. Commit.
