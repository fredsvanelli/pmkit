# PMK-257 adr-status outside tracker and report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline), with superpowers:test-driven-development.

**Goal:** Fix the five defects of the PMK-257 issue. **Spec:** `docs/superpowers/specs/2026-11-11-pmk-257-adr-status-outside-tracker-design.md`

## Global Constraints

- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `PMK-257` in every message. CHANGELOG line at the top of `## Unreleased`.
- No `spawnSync` without a large `maxBuffer`; no timeout on commits. Messages never show an absolute path.

## Review Focus

- Outside tracker, auto_commit on: with and without a git repository around it; no `UPSTREAM`, no absolute path in any output.
- `ref` for outside ADRs is followable; `path` still has the `tracker:` label.
- unchanged: before === after; both-places report; comment kept.

### Task 1: report (criteria 3, 4, 5) in `setAdrStatus`
- [ ] Failing tests in `scripts/adr.test.mjs` (unchanged `accepted` section reports equal; both places; `status: accepted # c` unchanged and `deprecated # c` keeps the comment); update the PMK-248 expectation that reports only the key.
- [ ] Edit `scripts/lib/adr.mjs`; run `node --test scripts/adr.test.mjs`.
- [ ] Commit.

### Task 2: followable `ref` (criterion 2)
- [ ] Failing test: outside tracker `--by` writes the root-relative path; update the two PMK-247/251 tests that expect `docs/adr/<name>` for an outside ADR.
- [ ] Edit `adrFolders`/`adrFiles` in `scripts/lib/adr.mjs`; commit.

### Task 3: commit outside the repository (criterion 1)
- [ ] Failing tests: outside folder inside its own git repo (one commit there, none in the project, exit 0) and in no repo (exit 0, `note:`, file written), no absolute path in stdout/stderr.
- [ ] Edit `commitTracker` and `autoCommit` in `scripts/pmkit.mjs`; commit.

### Task 4: docs, criteria and delivery
- [ ] CHANGELOG line; fix the PMK-247 changelog sentence that says `--by` writes `docs/adr/<name>`; `commands/spec/` text about `ref` if it needs it.
- [ ] `issues update PMK-257 --check 1..5` (dry-run, then real), commit `.issues/`.
- [ ] `npm test` in the foreground, exit 0; PR, summary comment, `in_review`.
