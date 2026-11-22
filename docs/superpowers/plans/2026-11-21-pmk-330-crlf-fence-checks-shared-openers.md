# PMK-330 CRLF Fence Checks And Shared Openers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the PMK-326 CRLF cases against fences, add the PMK-323 control with CRLF, share the opener and ending lists, and state the quote rule in the doc comment and CHANGELOG.

**Architecture:** Tests and comments only; no code line of `scripts/lib` changes.

**Tech Stack:** Node 18+, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-330-crlf-fence-checks-shared-openers-design.md`

## Global Constraints

- Existing test names and count unchanged; only the 20 new CRLF controls are added.
- No code line outside the tests changes.

## Review Focus

- A CRLF body with no final newline: covered by `ENDINGS`.
- The control with the container block holding `## Y`: it names only `## X`. Asserted.
- `crlf` applied to an already CRLF string would double `\r`: every caller passes LF text.

---

### Task 1: Shared lists, fence checks, CRLF control

**Files:** Modify `scripts/adr.test.mjs`.

- [ ] Record test names (`node --test --test-reporter=tap scripts/adr.test.mjs`, sorted).
- [ ] Hoist `HTML_KINDS`, `HTML_CONTAINERS`, `ENDINGS` (LF) and `crlf(text)` above the PMK-314 in-place table; use them in the two inline LF lists and both PMK-326 loops.
- [ ] Add `adrFenceHeld`, `adrFenceBlocks` and `get.data.fenceHeld` null checks to the CRLF in-place loop.
- [ ] Add the PMK-330 CRLF control loop (5 openers x 2 containers x 2 endings), refusing real and dry run with the exact HTML message.
- [ ] Run: names diff shows 0 removed and 20 added; all pass. A temporary mutation (`adrFenceBlocks` returning a fence for CRLF text) fails the 20 in-place CRLF tests; revert it.

### Task 2: Doc comment and CHANGELOG

**Files:** Modify `scripts/lib/adr.mjs` (the `adrHtmlHeld` JSDoc only) and `CHANGELOG.md` (the PMK-326 line of 0.6.0, and an Unreleased line).

- [ ] `git diff -U0 scripts/lib` shows only comment lines.
- [ ] `npm test`, `npm run lint`; commit.
