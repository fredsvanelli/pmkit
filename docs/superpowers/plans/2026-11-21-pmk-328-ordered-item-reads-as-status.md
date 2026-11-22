# PMK-328 Ordered Item Reads As Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `1. Proposed` reads as a status wherever `readsAsStatus` decides, as `- Proposed` does.

**Architecture:** Strip leading quote, bullet and ordered list markers before the first-word rule of `readsAsStatus`, in `scripts/lib/adr.mjs` and in its deliberate copy in `scripts/dev/adr-write-compare.mjs`.

**Tech Stack:** Node 18+ ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-328-ordered-item-reads-as-status-design.md`

## Global Constraints

- No dependencies (ADR 0003); commonmark.js only from outside the repository, for the dev check.
- Ordered marker: 1 to 9 digits, `.` or `)`, then a space or tab.
- `1.Accepted` and `see 1. Proposed` keep their behaviour.

## Review Focus

- `**1. Accepted**` (emphasis before digits): stays unread, as on develop. Test in Task 1.
- 10-digit marker `1234567890. Proposed`: stays unread. Test in Task 1.
- Nested `> 1. Proposed` after a status: refuses like `> - Proposed`. Test in Task 1.
- CRLF bodies: `adrText` normalizes before the rule; no extra test.
- The dev copy drifting from the lib: Task 2 test compares both on the same lines.

---

### Task 1: The rule in `scripts/lib/adr.mjs`

**Files:**
- Modify: `scripts/lib/adr.mjs` (`readsAsStatus`, near line 527)
- Test: `scripts/adr.test.mjs` (new PMK-328 loops after the PMK-325 ones)

- [ ] **Step 1: Write the failing tests.** A loop over `[marker]` in `1.`, `1)`, `10.`, `  1.`, `> 1.` with `- ` (and `> -`) as control:
  - `## Status\n\nAccepted\n\n<marker> Proposed\n\n## Context\n`: `adrStatus(root, '1', 'deprecated', ...args)` for `['--dry-run']` and `[]` gives code 2, message includes `would delete the other text of the Status section, "<marker trimmed> Proposed"`, file unchanged; `adrInfo(text).status` equals `adrInfo(bulletText).status` with `- ` replaced by the marker.
  - `## Status\n\n<marker> Accepted\n\n> Proposed\n\n## Context\n`: `adrStatusDropped(text)` deep-equals `['> Proposed']`.
  - Unchanged: `Accepted`, blank, `1.Accepted` and `Accepted`, blank, `see 1. Proposed`, `**1. Accepted**`, `1234567890. Proposed`: same refusal or write as develop (asserted by value: `adrStatusDropped` result and `setAdrStatus` text).
- [ ] **Step 2: Run** `node --test --test-name-pattern PMK-328 scripts/adr.test.mjs`. Expected: the ordered rows FAIL, controls PASS.
- [ ] **Step 3: Implement** `LIST_MARKERS = /^(?:[ \t>]|[-+*][ \t]|\d{1,9}[.)][ \t])*/` and `readsAsStatus(item)` applying it before the first-word regex.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `node --test scripts/adr.test.mjs`: PASS.
- [ ] **Step 5: Commit** `fix: read an ordered list item as a status (PMK-328)`.

### Task 2: The copy in `scripts/dev/adr-write-compare.mjs`

**Files:**
- Modify: `scripts/dev/adr-write-compare.mjs:14-17`
- Test: `scripts/dev/adr-write-compare.test.mjs`

- [ ] **Step 1: Failing test** `the copy of readsAsStatus reads an ordered list item as the lib does (PMK-328)`: `readsAsStatus` of `1. Proposed`, `1) Proposed`, `10. Proposed`, `> 1. Proposed` is true; of `1.Accepted`, `see 1. Proposed`, `**1. Accepted**`, `1234567890. Proposed` is false.
- [ ] **Step 2: Run** `node --test scripts/dev/adr-write-compare.test.mjs`: FAIL on the true rows.
- [ ] **Step 3: Implement** the same two lines; update the comment.
- [ ] **Step 4: Run**: PASS; also the PMK-324 prefix test stays green.
- [ ] **Step 5: CHANGELOG** `## Unreleased` line; **commit** `fix: the dev copy of readsAsStatus reads ordered items (PMK-328)`.

### Task 3: Evidence

- [ ] Scratch comparison develop x branch on random Status bodies (refusal, text written, `adrInfo` status, `adrStatusDropped`), every difference classified.
- [ ] `node scripts/dev/adr-commonmark-diff.mjs --commonmark <cm> --base origin/develop --head worktree`: exit 0, 0 worse.
- [ ] `npm test` and `npm run lint` pass.
