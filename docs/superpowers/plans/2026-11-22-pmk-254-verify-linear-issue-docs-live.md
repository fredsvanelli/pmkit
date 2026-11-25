# PMK-254 Verify Linear Issue Docs Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live run sends pmkit's docs writes through the guard, and the PMK-252 verification notes say what Linear really does.

**Architecture:** Two guard rules; a docs probe; the notes.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-254-verify-linear-issue-docs-live-design.md`

## Global Constraints

- No dependencies (ADR 0003). The key is never printed, logged or committed; no workspace name in any file.

## Review Focus

- `attachmentCreate` on an issue the run did not create is refused.
- `attachmentDelete` of an attachment the run did not create is refused.

---

### Task 1: Guard rules

**Files:** `scripts/lib/linear/sandbox.mjs`; test `scripts/lib/linear/sandbox.test.mjs`

- [ ] Tests: `attachmentCreate` passes on an owned issue with `metadata: { pmkitDoc }` and with no metadata, and owns the answer's id; refused on a foreign issue, an `http:` url, a metadata key other than `pmkitDoc`; `attachmentDelete` passes on an owned attachment and is refused on a foreign one; the allowlist is 19. Red, implement, green, commit.

### Task 2: Probe and notes

**Files:** `scripts/lib/linear/live-probes.mjs`, `scripts/lib/linear/contract-live.mjs`, `scripts/lib/linear/API-VERIFICATION.md`; test `scripts/lib/linear/sandbox.test.mjs`

- [ ] Test `the docs probe adds, reads and removes a doc and leaves a hand-made attachment alone` over the fake: no guard refusal, `recorded.conflict === true`, `recorded.handMadeLeft === true`; probes are seven. Red, implement, green. Live run; notes. CHANGELOG. `npm test`, `npm run lint`. Commit.
