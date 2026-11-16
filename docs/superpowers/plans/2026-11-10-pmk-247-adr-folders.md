# PMK-247 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** the ADR folder of a tracker at `tracker.path: .` follows `auto_commit`, and the folder of a tracker outside the repository has its own label.

**Architecture:** `adrFolders` in `scripts/lib/adr.mjs` is the only place that labels folders. `docs adr-status` already routes by `place`, `planNextAdr` by `place` too, so they follow.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-247-adr-folders-design.md`

## Global Constraints

- No dependencies; no absolute path of this machine in any JSON (PMK-194).
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in each message.

## Review Focus

- Hosted tracker (`trackerDir` null): still repository folder only, `adr-status` writes the repository file.
- `tracker.path: .` with `auto_commit: false`: writes through the tracker, commits nothing, no "repository file has no commit" note.
- `tracker.path: .` with no `docs/adr` yet: `next-adr` still answers `tracker` with `docPath`.
- Outside tracker and repository with the same number: `validate` problem and `CONFLICT` message list two different paths.

---

### Task 1: folders and labels (AC1, AC2)

**Files:** modify `scripts/lib/adr.mjs` (`adrFolders`, `planNextAdr` unchanged unless a test shows otherwise); test `scripts/adr.test.mjs`.

- [ ] Update the `adrFolders` test: `trackerDir: '/r/docs/adr'` gives `[['tracker', 'docs/adr']]`; add `trackerFolder: null, trackerDir: '/t/docs/adr'` gives `[['repo','docs/adr'], ['tracker','tracker:docs/adr']]`. Add a `next-adr` test with `tracker.path: .` and `docs/adr/0001-a.md`: `destination` is `tracker`, `docPath` `adr/0002-...`. Update the outside-tracker test: `path` is `tracker:docs/adr/0002-keep-estimates-in-points.md`. Run, expect FAIL.
- [ ] Implement in `adrFolders`: the merged entry has `place: 'tracker'`; an outside folder has `label: 'tracker:docs/adr'`. Run `node --test scripts/adr.test.mjs`, expect PASS.
- [ ] Commit.

### Task 2: CLI behaviour (AC1, AC2)

**Files:** test `scripts/adr.test.mjs` (and `scripts/cli-autocommit.test.mjs` if its helpers fit better).

- [ ] Tests: `adr-status` with `tracker.path: .` and `auto_commit: true` leaves a git commit for the ADR and `place` `tracker`; with `auto_commit: false` it writes, commits nothing and has no "repository file" note. Outside tracker plus repository ADR `0002`: `validate` problems and the `CONFLICT` error name `docs/adr/0002-a.md` and `tracker:docs/adr/0002-a.md`. Run, expect PASS after Task 1 (fix whatever fails).
- [ ] Commit.

### Task 3: docs

- [ ] `commands/spec/record-decision.md` step 6 and `commands/spec/adr-status.md` step 1 name the `tracker:` prefix; the scenarios and goldens that repeat those lines agree. CHANGELOG line under `## Unreleased`.
- [ ] Check the ACs with `issues update PMK-247 --check <n>` (dry run, then real), commit `.issues/`, `npm test` in the foreground (exit code 0), PR.
