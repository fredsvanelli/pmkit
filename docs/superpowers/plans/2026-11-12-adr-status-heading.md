# Find an indented or closed Status heading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task.

**Goal:** `docs adr-get` and `docs adr-status` find a `## Status` heading that is indented one to three spaces or has a closing `#` sequence.

**Architecture:** The Status heading is found with `headingLevel(item) === 2` plus a new `headingText` helper (content without the opening and closing `#`), replacing the `STATUS_SECTION` regex. `setAdrStatus` already rewrites only the body, so the heading stays as written.

**Tech Stack:** Node ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-adr-status-heading-design.md`

## Global Constraints

- One parser for status (PMK-263): `locate` serves `adrInfo` and `setAdrStatus`.
- Setext `Status` is out of scope (PMK-283). Four spaces is code. Fenced `## Status` stays ignored.

## Review Focus

- `## Status#` is not a closing sequence: no section found.
- `## Status ##` and `## Status #####`: section found, heading kept on rewrite.
- Four spaces of indent and a fenced `## Status`: ignored.
- `##\tStatus`: found.
- `## Status` heading inside an ADR that also has a `status:` key: both change, as before.

---

### Task 1: Find the Status heading with the shared heading rules

**Files:**
- Modify: `scripts/lib/adr.mjs` (`STATUS_SECTION`, `locate`)
- Test: `scripts/adr.test.mjs`

**Interfaces:**
- Produces: `headingText(item: string): string` (module-private), `locate(lines).section` unchanged in meaning.

- [ ] **Step 1: Failing tests** (`adrInfo`/`setAdrStatus` for each heading form above with before/after text and the heading kept; negatives; CLI `docs adr-get`, `docs adr-status --dry-run` and real on a temp repo).
- [ ] **Step 2:** Run `node --test scripts/adr.test.mjs`; the new tests fail.
- [ ] **Step 3:** Add `headingText` (strip `^ {0,3}#{1,6}`, trim, remove `(^|[ \t]+)#+$`), set `section: at((item) => headingLevel(item) === 2 && /^status$/i.test(headingText(item)))`, delete `STATUS_SECTION`.
- [ ] **Step 4:** Run `node --test scripts/adr.test.mjs`; all pass. Compare `adrInfo` of develop and this branch on every ADR text of the tests.
- [ ] **Step 5:** Commit with the issue ID.

### Task 2: Deliver

- [ ] CHANGELOG line under `## Unreleased`; check the two criteria (dry-run, then real); commit `.issues/`; `npm test` in foreground exit 0; PR; comment; `in_review`.
