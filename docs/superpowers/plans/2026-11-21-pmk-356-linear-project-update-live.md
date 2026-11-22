# PMK-356 Linear projectUpdate Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live Linear contract run includes `deliverable-writes` (epic move) and passes, behind a guard rule for `projectUpdate`.

**Architecture:** `SUITE_INPUT_KEYS.projectUpdate = ['statusId']` and an ownership rule in `scripts/lib/linear/sandbox.mjs`; `deliverable-writes` in `LINEAR_FAMILIES`; introspection and the run recorded in `API-VERIFICATION.md` and the PR.

**Tech Stack:** Node 18+, `node:test`, the live sandbox of `contract-live.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-356-linear-project-update-live-design.md`

## Global Constraints

- The repository is public: no workspace URL key or key in a file, commit or comment.
- Live writes only to the `pmkit-test` sandbox team, through the guard.

## Review Focus

- `projectUpdate` with a key besides `statusId`: refused. Test.
- `projectUpdate` on a project the run did not create: refused. Test.
- A `statusId` that is not a string (`null`, a number): refused. Test.

---

### Task 1: Guard rule

- [ ] Failing tests in `sandbox.test.mjs`: the allowed row, the refused row, the input-key and type refusals, the count 16, the document shape list.
- [ ] Implement the rule and the key list; tests pass.

### Task 2: Live

- [ ] Read-only probe: the sandbox team exists and passes `checkTestTeam`; introspect `ProjectUpdateInput`.
- [ ] `cleanup` (no writes) shows the team empty; the live run with `deliverable-writes` passes; `cleanup` after.
- [ ] `LINEAR_FAMILIES`, the comments, `API-VERIFICATION.md`, CHANGELOG; `npm test`, `npm run lint`, commit.
