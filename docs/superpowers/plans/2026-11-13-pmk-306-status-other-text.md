# PMK-306 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** adr-status refuses, naming every cause at once, instead of deleting other Status text.
**Spec:** docs/superpowers/specs/2026-11-13-pmk-306-status-other-text-design.md

## Global Constraints
Commits carry PMK-306 and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `adrInfo` unchanged (run `node scripts/dev/adr-commonmark-diff.mjs`).

## Review Focus
CRLF; 4-space line in a fence; HTML+fence together; status-only section; dry run writes nothing.

### Task 1: tests first (scripts/adr.test.mjs)
- [ ] Add tests: paragraph after status; unclosed fence with text, no heading; `    ## Context` in fence; HTML+fence refusal naming both; status-only writes; CRLF; dry-run and real leave the file unchanged.
- [ ] Update HELD_OK/FENCE_OK cases that now refuse. Run `node --test scripts/adr.test.mjs`: new tests FAIL.

### Task 2: `adrStatusDropped` in scripts/lib/adr.mjs, one refusal in `runAdrStatus` (scripts/pmkit.mjs)
- [ ] Implement per the spec; run adr tests: PASS.

### Task 3: docs and delivery
- [ ] CHANGELOG line under Unreleased, check criteria, `npm test` exit 0, commit, PR.
