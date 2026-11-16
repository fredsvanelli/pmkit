# PMK-180 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use TDD: failing test, fix, `npm test`.

**Goal:** Fix four defects of saved views (PMK-44): bad file names, doctor advice, Linear hint, `filterText` quoting.

**Architecture:** `listViews` returns bad names as `problems`; the CLI returns `{ views, problems }` in JSON; text fixes elsewhere.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-pmk-180-views-names-design.md`

## Global Constraints

- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID PMK-180 in every commit.
- No em dashes in new text; `npm test` must exit 0.

## Review Focus

- A view named `bad+name.yaml` and a view with a broken body in the same folder: both are reported, the good ones still list.
- `views list` on Linear still refuses as before (degraded coverage test).
- A label holding a comma, a space or `=` prints quoted.

---

Tests first for each task (superpowers:test-driven-development); spec: `docs/superpowers/specs/2026-11-08-pmk-180-views-names-design.md`.

1. **`listViews` reports bad names** (AC 1). Test in `scripts/cli.test.mjs`: `views list --json` with `bad+name.yaml` returns `problems` with that id, and stderr has the warning. Change `listViews` and the `views list` command (`data: { views, problems }`). Update `run-view.md`, goldens and `scripts/golden-cases.mjs` expectations, and any test reading the array.
2. **Doctor** (AC 2). Edit `commands/local/doctor.md` step 5; check `scripts/__scenarios__` for a doctor scenario that names the old exception and keep it consistent.
3. **Linear hint** (AC 3). Update `scripts/lib/linear/manifest.test.mjs` then `manifest.mjs`.
4. **`filterText` quoting** (AC 4). Test through `views save`/`views list` text with a label holding a space and `=`. Change `filterText`.
5. **Docs**: CHANGELOG line under `## Unreleased`; README/SKILL.md only if they describe the JSON of `views list`.
6. **Verify**: `npm test` in the foreground, exit code 0. Check each AC with `issues update PMK-180 --check <n>`, commit `.issues/`.
