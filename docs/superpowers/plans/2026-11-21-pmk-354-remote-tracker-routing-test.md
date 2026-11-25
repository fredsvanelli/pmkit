# PMK-354 Remote Tracker Routing Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A test fails when a contract operation that a Linear or GitHub `*-ops.mjs` module implements is missing from that tracker's `contract` map.

**Architecture:** `scripts/lib/tracker-routing.test.mjs` lists each `*Operations` factory's contract operations (factories called with an inert proxy), builds each tracker over its fake, calls every listed operation with no arguments, and fails on the stub's `does not implement <op> yet`.

**Tech Stack:** Node 18+, `node:test`, the fakes of `scripts/fake-github-issues.mjs` and `scripts/fake-linear-api.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-354-remote-tracker-routing-test-design.md`

## Global Constraints

- Nothing outside the test changes; the stubs stay as they are.

## Review Focus

- A guard that fails before the body (scope, mappings) would hide a stub: the stub runs the same guard, so a mutation that drops a route still shows. Proven by the mutation step.
- A module that reads nothing: the floor of 30 operations per system fails it.
- A new `*-ops.mjs` module: picked up by the directory listing.

---

### Task 1: The test

- [ ] Write `scripts/lib/tracker-routing.test.mjs` with `opsOperations(system)`, `unrouted(tracker, operations, system)` and one test per system.
- [ ] Run `node --test scripts/lib/tracker-routing.test.mjs`: 2 pass.
- [ ] Throwaway mutation: delete `moveDeliverable: projects.moveDeliverable,` from `scripts/lib/github/tracker.mjs`; the GitHub test fails naming `moveDeliverable (project-ops.mjs)`. Same for Linear. Revert both.
- [ ] CHANGELOG Unreleased line; `npm test`, `npm run lint`; commit.
