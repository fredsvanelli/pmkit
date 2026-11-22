# PMK-329 Hidden Quote And Shown Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `adr-status` refusal keeps the status line the reader sees past a quote of definitions, and the no-status fallback never keeps a hidden definition.

**Architecture:** One tracker of hidden blocks (`runs`, with `from`) in the walk of `statusSection`; a quote whose blocks are all hidden is hidden in its parent; `statusLineOf`'s fallback returns `glued` when `first` is not shown.

**Tech Stack:** Node 18+ ES modules, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-pmk-329-hidden-quote-and-shown-fallback-design.md`

## Global Constraints

- Only refusal names change: refusal, text written and `adr-get` status stay equal to develop.
- A list item holding only definitions is never hidden.

## Review Focus

- A quote opened by an empty `>` line: its first line opens no paragraph, so `statusLineOf` takes its other path, as on develop. Out of scope; the comparison covers it.
- A quote of definitions followed by a thematic break, then a paragraph: the break is shown, so the fallback stays. Test in Task 1.
- A quote holding definitions and indented code: not all hidden, unchanged. Covered by the comparison.
- Nested quote of definitions: hidden through both levels. Test in Task 1.
- CRLF: `adrText` normalizes first; no extra test.

---

### Task 1: The walk and the fallback

**Files:**
- Modify: `scripts/lib/adr.mjs` (`add({ type: 'quote', start: j })` in `sectionEnd`; the walk in `statusSection`; `statusLineOf`)
- Test: `scripts/adr.test.mjs` (PMK-329 loop after the PMK-328 loops; the PMK-322 row `a definition over two lines with no later status`)

- [ ] **Step 1: Failing tests.** A table of `[name, body, dropped, kept]`, each run through `adrStatusDropped` and the CLI (`--dry-run` and real, code 2, message holds the dropped names and not `kept`, file unchanged):
  - `> [a]: /u`, blank, `> Date: x`, `> Accepted`, blank, `> Proposed` → `['> [a]: /u', '> Date: x', '> Proposed']`, kept `> Accepted`
  - the same without the last quote → `['> [a]: /u', '> Date: x']`
  - `> > [a]: /u`, blank, `> > Date: x`, `> > Accepted` → `['> > [a]: /u', '> > Date: x']`
  - `[a]: /u`, blank, `Date: x`, `Foo` → `['[a]: /u', 'Foo']`, kept `Date: x`
  - Controls, by `adrStatusDropped` only: `- [a]: /u`, blank, `- Date: x`, `  Accepted`, blank, `> Proposed` → `['- [a]: /u', '- Date: x', 'Accepted']`; `> [a]: /u`, blank, `---`, `Date: x`, `Foo` → as develop.
  - The PMK-322 row changes to drop `['[Draft]:', 'Rejected']` and keep `see ADR 3`.
- [ ] **Step 2: Run** `node --test --test-name-pattern "PMK-329|PMK-322" scripts/adr.test.mjs`. Expected: the new rows FAIL.
- [ ] **Step 3: Implement** `runs` with `from`, `hiddenBefore(node)`, `hide(node, line)` (recursing into a quote whose run spans `1..children`), `start` on quotes, and the fallback `sees(first) || glued === undefined ? first : glued`. Remove `hidden`.
- [ ] **Step 4: Run** `node --test scripts/adr.test.mjs`. Expected: PASS.
- [ ] **Step 5: CHANGELOG** `## Unreleased` line; **commit** `fix: skip a quote of definitions and keep a shown fallback line (PMK-329)`.

### Task 2: Evidence

- [ ] Scratch develop x branch comparison: refusal, text written, `adr-get` status equal; only names differ, each classified.
- [ ] `adr-commonmark-diff.mjs` full run: exit 0, 0 worse.
- [ ] `npm test`, `npm run lint`.
