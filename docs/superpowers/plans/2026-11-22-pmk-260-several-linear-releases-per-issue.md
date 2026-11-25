# PMK-260 Several Linear Releases Per Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Option B of PMK-246-1 on Linear. **Spec:** `docs/superpowers/specs/2026-11-22-pmk-260-several-linear-releases-per-issue-design.md`

## Global Constraints
- No dependencies (ADR 0003). The list reads keep their selections.

## Review Focus
- A release whose pipeline is unknown is replaced, as before.

### Task 1: Rule and text
- [ ] Tests (two pipelines in the fake): get text shows both releases; `none` clears both; `<A id>` replaces only A's; bulk follows. Red, implement, green, commit.

### Task 2: Docs
- [ ] CHANGELOG, `API-VERIFICATION.md`; `npm test`, `npm run lint`. Commit.
