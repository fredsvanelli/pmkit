# PMK-184 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Fix the three PMK-184 defects of `deploys list` and `ci logs`.
**Architecture:** Guard in the command; `ciLogs` in `scripts/lib/github/host.mjs` returns `conclusion` and `status`; the command derives `failed`, `hasLog`, `logNote`.
**Tech Stack:** Node, node:test, fake gh.
**Spec:** `docs/superpowers/specs/2026-11-08-pmk-184-deploys-ci-logs-fixes-design.md`

## Global Constraints
Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID in every commit.

## Review Focus
- `--run` for a run still in progress: note says "has not finished", no conclusion drawn.
- `--run` on an unknown run: gh error stays an error (no null fields).
- `--environment` valueless in text and `--json` mode.
- Goldens and docs agree with new output.

### Task 1: valueless flags (AC 1)
**Files:** `scripts/pmkit.mjs` (deploys list, ci logs), `scripts/cli-deploys-ci.test.mjs`
- [ ] Test: `deploys list --environment` and `ci logs --branch` exit 2 `INVALID_INPUT`, no gh calls.
- [ ] Guard `typeof v !== 'string' || v === ''`; run tests.
- [ ] Commit.

### Task 2: ci logs run state (AC 2, 3)
**Files:** `scripts/lib/github/host.mjs`, `scripts/pmkit.mjs`, `scripts/github-host.test.mjs`, `scripts/cli-deploys-ci.test.mjs`
- [ ] Host tests: `ciLogs({runId})` calls `run view 99 --json ...` then `--log-failed`; returns workflowName, url, conclusion, status; skips log for success and startup_failure.
- [ ] CLI tests for each `logNote` case.
- [ ] Implement; update goldens, README, SKILL.md, CHANGELOG.
- [ ] Commit.
