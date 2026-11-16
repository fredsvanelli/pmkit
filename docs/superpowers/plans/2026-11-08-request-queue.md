# request-queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/pmkit:backlog:request-queue`, which works the open requests into new issues, links or declines, after a full preview.

**Architecture:** A command file only, composing existing CLI calls (`capabilities`, `requests list`, `issues list`, `issues create`, `requests accept`, `requests decline`). No CLI or capability change.

**Spec:** `docs/superpowers/specs/2026-11-08-request-queue-design.md`

## Global Constraints

- Every call ends with `--json`; every flag exists in the CLI.
- Write calls need a declared confirmation point.
- Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, issue ID in each commit.
- Incomplete reads (`problems`, `hasMore`, NOT_SUPPORTED) never become "empty" or "no match".

## Review Focus

- `problems` in `requests list`: warning, no "inbox empty" claim.
- Linear path: suggests triage and stops.
- Create succeeds, accept fails: both IDs reported, no retry.
- Scenarios agree with the steps of the command file.

### Task 1: Command file and scenarios (TDD)
- Update counts (`scripts/scenarios.test.mjs`), `COMMANDS` (`scripts/plugin.test.mjs`), `scripts/scenarios-live.mjs`; run, expect FAIL.
- Write the command file and scenarios on the `team` fixture: (0) one request into a new issue, one linked, one declined; (1) Linear path stops with AUTH; (2) a request file with conflict markers: warning, readable request still listed; (3) accept failure after create.
- Generate goldens, read them, rerun, expect PASS.
- Commit.

### Task 2: Registry and delivery
- README row, SKILL.md row, CHANGELOG line at the top of `## Unreleased`.
- Full suite by the machine baseline rule; tick criteria; commit `.issues/`; PR; summary comment; `in_review`.
