# PMK-277 Path after a bracket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `hideAbsolutePaths` hides an absolute path that follows `[`, `,`, `;`, `<` or `@`.

**Architecture:** Add the five characters to the two start lookbehinds in `scripts/lib/paths.mjs`. End rules and the function signature stay.

**Tech Stack:** Node, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-277-path-after-bracket-design.md`

## Global Constraints

- Name and signature of `hideAbsolutePaths` do not change (PMK-278 calls it).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID in each message.

## Review Focus

- `]` or `>` after the path leaves no piece of it (test).
- A quoted path with a space after a new start (`['/Users/x y']`, `<'/Users/x y'>`) is hidden whole (test).
- Existing O'Brien, `key=/x`, `file:///x`, UNC and `https:<path>` cases still pass.

---

### Task 1: Widen the start characters

**Files:**
- Modify: `scripts/lib/paths.mjs:28-31` (both lookbehinds, and the doc comment above)
- Test: `scripts/paths.test.mjs`

**Interfaces:** Produces: unchanged `hideAbsolutePaths(text: string): string`.

- [ ] **Step 1: Write the failing tests** in `scripts/paths.test.mjs`, one `test('hideAbsolutePaths starts a path after ...')` per character plus the review-focus cases, e.g. `hideAbsolutePaths('[/Users/x/repo]') === '[<path>'`, `'a,/Users/x'` → `'a,<path>'`, `'a;/Users/x'` → `'a;<path>'`, `'</Users/x>'` → `'<<path>'`, `'user@/Users/x'` → `'user@<path>'`, `"['/Users/x y']"` and `"<'/Users/x y'>"` show no `Users`, `x y`, or `/`.
- [ ] **Step 2: Run** `node --test scripts/paths.test.mjs`. Expected: the new tests FAIL.
- [ ] **Step 3: Add `[,;<@` to both lookbehind sets** (first `[\\s(=:]`, second `[\\s'"(=:]`); update the doc comment's list of starts.
- [ ] **Step 4: Run** `node --test scripts/paths.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `fix(paths): hide an absolute path after a bracket, comma, semicolon, angle bracket or at sign (PMK-277)`.

### Task 2: Changelog, criteria, delivery

- [ ] Add a line at the top of `## Unreleased` in `CHANGELOG.md`.
- [ ] Run `npm test` in the foreground; require exit code 0.
- [ ] Check criterion 1 with `issues update PMK-277 --check 1` (dry-run, then real), commit `.issues/`.
