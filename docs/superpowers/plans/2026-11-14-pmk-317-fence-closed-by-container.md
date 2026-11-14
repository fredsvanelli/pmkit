# PMK-317 Fence closed by its container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs adr-status` writes in place, and `adr-get` does not note, a fence closed by the end of its quote or list item.

**Architecture:** `sectionEnd` (the one walk that continues quotes and items) marks a fence block `ended` when its container ends before a later non-blank line of the section; `fenceRisk` exempts, in place, `closer !== undefined || ended`.

**Tech Stack:** Node 22, `node:test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-pmk-317-fence-closed-by-container-design.md`

## Global Constraints

- Every commit message carries `(PMK-317)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` in the foreground, Node 22, exit code 0 before the PR. No `pkill`/`killall` with a pattern.
- No second way to find the end of a container: the mark is set inside `sectionEnd`.

## Review Focus

- Item fence continued across a blank line and an indented line stays open (still refused if the heading follows it only after blanks).
- Quote fence followed by a lazy-looking line without `>` (`Date:`) is closed; followed only by blanks and `## Context` stays refused.
- Fence open at the end of the file, in a quote or item, stays refused.
- Whole-section replacement (status in a quote or item, no known status, two statuses) still refuses, real and dry run.
- CRLF and `~~~` fences, nested quote in item.

---

### Task 1: Mark fences their container ended, and exempt them in place

**Files:**
- Modify: `scripts/lib/adr.mjs` (`sectionEnd`, `fenceRisk`)
- Test: `scripts/adr.test.mjs` (next to the PMK-314 tests, ~line 2091)

**Interfaces:**
- Produces: fence blocks in `held` may carry `ended: true`. `fenceRisk` (used by `adrFenceHeld`, `adrFenceBlocks`) skips, in place, fences with `closer !== undefined || ended`.

- [ ] **Step 1: Failing tests.** Add to the PMK-314 in-place list (`name, text` pairs, same loop: `adrHtmlHeld`/`adrFenceHeld` null, `adrFenceBlocks` `[]`, adr-get status `Accepted` with no notes, dry run and real write only change `Accepted`): a quote fence ended by a blank then a date (`## Status\n\nAccepted\n\n> ```\n> ## X\n\nDate: 2024-01-02\n\n## Context\n`); the item form (`- ```` `, `  ## X`, blank, `Date: ...`); `~~~` quote; item whose fence runs over a blank and an indented line then ends at a non-indented line; setext heading in the fence; a nested `> ` in an item; CRLF; a quote fence ended by a lazy-looking text line with no blank (`> ```\n> ## X\nDate: ...`).
- [ ] **Step 2: Failing refusal tests.** Add to the "still refuses" list (guard `fence`): quote and item fence followed by blanks then `## Context` (existing quote case stays, add the item case), quote and item fence at end of file, item fence kept open by blank + indented line up to the heading, and whole-section cases: status in a quote with the fence ended by a date line, status in an item, no known status line, two status lines, a fence before the status.
- [ ] **Step 3: Run** `node --test scripts/adr.test.mjs`; expected: the new in-place tests FAIL, the refusal tests pass.
- [ ] **Step 4: Implement** in `sectionEnd`: `pending` (fences dropped by their container, not yet settled) and `lastBlank`. After the continue loop, when the line did not close a fence and `open.at(-1)` is a fence with `matched < open.length - 1`, push it to `pending`. At the top of each iteration and after the loop, if `pending` is non-empty and the previous line was non-blank, set `ended = true` on each and clear it. A blank line only pushes; the heading that returns early never settles.
- [ ] **Step 5: Implement** `fenceRisk`: `!(inPlace && (item.block.closer !== undefined || item.block.ended))`; update its comment and the `adrFenceHeld` doc.
- [ ] **Step 6: Run** `node --test scripts/adr.test.mjs scripts/scenarios.test.mjs`; all pass. Then `node scripts/pmkit.mjs`-level repros via the CLI on a temp repo copy for the two issue texts, real and dry run, `docs adr-status 1 deprecated` and `docs adr-get 1`.
- [ ] **Step 7: Commit** `fix(adr): write in place past a fence its quote or list item closes (PMK-317)`.

### Task 2: Docs, proof and delivery

**Files:** `commands/spec/adr-status.md`, `docs/adr/0006-*.md` if it names the rule, `README.md` if it cites the case, `CHANGELOG.md` (top of `## Unreleased`).

- [ ] **Step 1:** update the docs and CHANGELOG line in the style of the PMK-316 line.
- [ ] **Step 2:** develop against branch on random Status bodies (script in the scratchpad): counts of bodies and divergences (refusal, written text, `adr-get` reading), each divergence is a fence closed by its container; no new write removes a non-blank line other than the status line.
- [ ] **Step 3:** `node scripts/dev/adr-commonmark-diff.mjs` in full after the change, 0 worse; keep the before and after output for the PR.
- [ ] **Step 4:** `npm test` in the foreground, exit 0. Commit, check criteria with `issues update PMK-317 --check <n>`, commit `.issues/`.
