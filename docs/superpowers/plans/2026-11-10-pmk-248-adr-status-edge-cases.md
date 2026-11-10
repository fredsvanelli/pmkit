# PMK-248 adr-status edge cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline).

**Goal:** `docs adr-status` leaves an ADR untouched when its status does not change, and rewrites every status an ADR holds.
**Architecture:** Change `setAdrStatus` in `scripts/lib/adr.mjs` only. The CLI already reports `unchanged` when `before === after`.
**Tech Stack:** Node, `node:test`.
**Spec:** `docs/superpowers/specs/2026-11-10-pmk-248-adr-status-edge-cases-design.md`

## Global Constraints
- Every commit message carries `PMK-248` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
- Section already `Accepted` with no blank lines: unchanged, text identical.
- Lowercase body `accepted`: unchanged.
- Front matter and section both present, different statuses: both rewritten.
- Front matter and section both already equal to the new status: unchanged.
- `superseded by <path>` compared with the section's `Superseded by <path>`: unchanged.

### Task 1: setAdrStatus
**Files:** Modify `scripts/lib/adr.mjs` (`setAdrStatus`); test `scripts/adr.test.mjs`; `CHANGELOG.md`.

- [ ] Write failing tests in `scripts/adr.test.mjs` for each Review Focus line (assert `text` equals the input where unchanged).
- [ ] Run `node --test scripts/adr.test.mjs`: the new tests fail.
- [ ] In `setAdrStatus`, edit the front matter key and the `## Status` section independently (no early return after the key), then return the original text when each edited place already held `value` ignoring case.
- [ ] Run `node --test scripts/adr.test.mjs`: passes.
- [ ] Add a line under `## Unreleased` in `CHANGELOG.md`; check the acceptance criteria; commit `.issues/`; run `npm test` in the foreground.
