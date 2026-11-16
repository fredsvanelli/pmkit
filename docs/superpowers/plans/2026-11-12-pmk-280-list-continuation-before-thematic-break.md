# PMK-280 List Item Continuation Before a Thematic Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `## Status` stays open past a list item continuation followed by `---`, in `adr-get` and `adr-status`.

**Architecture:** In `locate().end` (`scripts/lib/adr.mjs`), after the walk finds the setext paragraph start `top`, skip it when `top` continues a list item above it. One shared parser, so both commands change together.

**Tech Stack:** Node, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-280-list-continuation-before-thematic-break-design.md`

## Global Constraints

- No full list parser; reuse `headingLevel`, `INTERRUPTS_PARAGRAPH`, `THEMATIC_BREAK`.
- Do not touch PMK-281..283 scope.
- Commits carry `(PMK-280)` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- `- a\n\n b\n---` (indent below the item content): still a setext paragraph, section ends at `b`.
- Ordered item `1. a\n\n   b\n---`: continuation.
- Two-line continuation `  b\n  c\n---`: continuation.
- Continuation inside a fenced block or after a non-list paragraph at indent 0: unchanged.

### Task 1: Continuation of a list item is not a setext paragraph

**Files:**
- Modify: `scripts/lib/adr.mjs` (`locate`, near `INTERRUPTS_PARAGRAPH`)
- Test: `scripts/adr.test.mjs`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces: `continuesListItem(top: number): boolean` local to `locate`.

- [ ] **Step 1: Write failing tests**: `adrInfo`/`setAdrStatus` on the issue text and on the Review Focus cases; same through `adrGetFrom`/`adrStatus`.
- [ ] **Step 2: Run `node --test scripts/adr.test.mjs`; the new tests fail.**
- [ ] **Step 3: Implement `continuesListItem`**: scan back from `top - 1` skipping blank and fenced lines; true at a list item line whose content offset is `<=` the indent of `top`; false at a non-blank line with no indent; false when `top` has no indent. `end` returns `top` only when it is not a continuation.
- [ ] **Step 4: Run the file again; all pass.**
- [ ] **Step 5: CHANGELOG line, `npm test` in the foreground (exit 0), commit.**
