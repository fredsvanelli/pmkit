# PMK-251 Supersedes line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** `record-decision` writes a Supersedes line in a new ADR and marks the older ADR superseded after confirmation.

**Architecture:** Command-file change only; reuses `docs adr-status`.

**Tech Stack:** Markdown command file, node:test.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-251-supersedes-line-design.md`

## Global Constraints

- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in every message.
- CHANGELOG line at the top of `## Unreleased`.

## Review Focus

- Decision replaces nothing: no extra ask result, no Supersedes line, no `adr-status` call (scenarios 0 and 1 skip them).
- Old number does not exist: stops before any write (step 2).
- User declines step 7 or it fails: new ADR stays, old one untouched, `/pmkit:spec:adr-status` offered.
- Step 6 fails: step 7 still runs.

### Task 1: Command file, tests and docs

**Files:** Modify `commands/spec/record-decision.md`, `scripts/plugin.test.mjs`, `scripts/__scenarios__/spec-record-decision.mjs`, `README.md`, `CHANGELOG.md`; create `scripts/__scenarios__/_inputs/adr-0003-supersedes.md` and the `spec-record-decision.2.after.txt` snapshot.

- [ ] Write the step 2/4/7 assertions in `plugin.test.mjs` and the third scenario entry; run, expect failure.
- [ ] Edit steps 1, 2, 4, 7 (old 7, 8 become 8, 9), Confirmation points and Output.
- [ ] `UPDATE_GOLDENS=1 node --test scripts/scenarios.test.mjs`, then `npm test` exits 0.
- [ ] Tick the acceptance criteria, commit `.issues/` and the change.
