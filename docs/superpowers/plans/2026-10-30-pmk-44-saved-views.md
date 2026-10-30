# Saved views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store, list and run named issue filters in the Local tracker.

**Architecture:** A new module `scripts/lib/local/views.mjs` parses and serializes view files. `createLocalTracker` gets `saveView`, `listViews` and `runView`. Three CLI commands call them. The manifest serves `saved_views` from them.

**Tech Stack:** Node ESM, `node:test`, the repo's own YAML subset.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-44-saved-views-design.md`

## Global Constraints

- Every commit message carries `(PMK-44)`.
- Edits to `README.md`, `CHANGELOG.md`, `commands/help.md`, `skills/pmkit/` and `scripts/lib/capabilities.mjs` stay small.
- Goldens regenerate with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs` and the diff gets read.

## Review Focus

- A filter with `sprint: current` stays symbolic in the file (task 1).
- A name with `..` or `/` is refused (task 1).
- A view whose stored filter turned invalid (a type removed from the config) fails `views run` with `INVALID_INPUT`, not a crash (task 2).
- `--replace` keeps one file and leaves the other views untouched (task 2).
- Linear answers `NOT_SUPPORTED` on all three commands (task 3).

### Task 1: view files

**Files:** Create `scripts/lib/local/views.mjs`, `scripts/views.test.mjs`.

**Interfaces:** Produces `validViewName(name)`, `parseView(text, name) -> { name, filter }`, `serializeView(filter) -> string`, `viewStems(dir) -> Set<string>`.

- [ ] Write tests: round trip of a filter with lists, a boolean, a number and `sprint: current`; `validViewName` is false for `a/b`, `..` and an empty string; `parseView('filter: 3', 'x')` throws `INVALID_INPUT`.
- [ ] Run `node --test scripts/views.test.mjs`, expect FAIL.
- [ ] Implement with `parseYaml` and `stringifyYaml`, the name rule of `validMilestoneId`, and stems from `.yaml` files.
- [ ] Run, expect PASS. Commit.

### Task 2: tracker operations

**Files:** Modify `scripts/lib/contract.mjs`, `scripts/lib/local/tracker.mjs`. Tests in `scripts/views.test.mjs`.

**Interfaces:** Consumes task 1. Produces `saveView`, `listViews`, `runView` as in the spec.

- [ ] Tests with a temp tracker: save, list and run return the matching issues; a second save is `CONFLICT`; `replace: true` succeeds; an empty filter and an unknown category are `INVALID_INPUT`; a dry run writes nothing; run of a missing view is `NOT_FOUND`; run of a view with a stale type is `INVALID_INPUT`.
- [ ] Run, expect FAIL.
- [ ] Add the operations to `TRACKER_OPERATIONS` and implement them in the tracker (`requireWriter`, `checkFilter`, `writeFile`).
- [ ] Run `npm test`, fix tests that list every operation. Commit.

### Task 3: CLI, capability, Linear

**Files:** Modify `scripts/pmkit.mjs`, `scripts/lib/capabilities.mjs`, `scripts/lib/linear/manifest.mjs`, `scripts/lib/linear/manifest.test.mjs`, `scripts/capabilities.test.mjs`, `scripts/cli.test.mjs`, `scripts/cli-degraded-coverage.test.mjs`, `scripts/cli-linear.test.mjs`, `scripts/golden-cases.mjs`.

- [ ] Tests: `views save`, `list` and `run` through the CLI (text and `--json`); `capabilities` shows `saved_views` native; the Linear manifest detail has `unsupported: ['saveView', 'listViews', 'runView']`; the Linear CLI returns `NOT_SUPPORTED`.
- [ ] Run, expect FAIL.
- [ ] Implement the three commands, reusing `issueFilter(ctx)` and the `issues list` output. Set `SERVED_BY.saved_views`.
- [ ] Add golden cases, regenerate goldens, read the diff. Run `npm test`. Commit.

### Task 4: skill, docs, changelog, criteria

- [ ] Update `commands/issues/find.md` step 7, the `README.md` table, `commands/help.md` and `skills/pmkit/` routing where neighbors list commands, and the top line of `CHANGELOG.md`.
- [ ] Tick the four criteria with `issues update PMK-44 --check n`, commit `.issues/`.
- [ ] `npm test` passes.
