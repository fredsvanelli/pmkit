# PMK-255 Milestone Writes In The Linear Live Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live sandbox guard lets the three milestone writes through, on milestones the run owns, and a live probe sends them.

**Architecture:** One input key and one ownership check in the guard, one guarded `projectMilestoneCreate`, one probe.

**Tech Stack:** Node 18 ES modules, `node:test`, the fake Linear API.

**Spec:** `docs/superpowers/specs/2026-11-22-pmk-255-milestone-writes-in-linear-live-sandbox-design.md`

## Global Constraints

- No dependencies (ADR 0003). The key is never printed, logged or committed; no workspace name in any file.

## Review Focus

- A foreign `projectMilestoneId` is refused by the ownership reason, not let through.
- `projectMilestoneId: null` passes.
- `projectMilestoneCreate` on a project the run did not create is refused.
- After `guard.stop()`, `projectMilestoneCreate` is refused like every non-delete.

---

### Task 1: Guard rules

**Files:** Modify `scripts/lib/linear/sandbox.mjs`; Test `scripts/lib/linear/sandbox.test.mjs`

**Produces:** `export const MILESTONE_CREATE = 'mutation PmkitSandboxMilestoneCreate($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success projectMilestone { id } } }'`

- [ ] Tests: `issueUpdate` and `issueCreate` pass with an owned milestone and with `null`; the existing foreign-key test's `projectMilestoneId: 'm-foreign'` row moves to a new test that expects `/projectMilestoneId is not one the run owns/`; `projectMilestoneCreate` passes on an owned project and owns the answer's id; refused on a foreign project and after `stop()`; allowlist count 17. Run: red.
- [ ] Implement per the spec. Run `node --test scripts/lib/linear/sandbox.test.mjs`: green. Commit.

### Task 2: Probe

**Files:** Modify `scripts/lib/linear/live-probes.mjs`, `scripts/lib/linear/sandbox.test.mjs` (liveWorld gains `PmkitSandboxMilestoneCreate` through `projects.seedMilestone`)

- [ ] Test `the milestone probe sends the three milestone writes through the guard`: over the fake, the probe returns asserted lines, the three issues read back with the milestone (one cleared), no guard refusal; `PROBES.length` 5. Run: red.
- [ ] Implement `milestoneProbe({ tracker, client, actor })`. Green. Update the probe-count comment (at most 7 issues). Commit.

### Task 3: Docs, live run

- [ ] `API-VERIFICATION.md`: allowlist names `projectMilestoneCreate`; record the live run. CHANGELOG line. `npm test`, `npm run lint`. Commit.
- [ ] Live run `contract-live.mjs` with the key loaded at run time; `cleanup` shows the team empty.
