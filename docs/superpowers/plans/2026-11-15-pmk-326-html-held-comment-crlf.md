# PMK-326 adrHtmlHeld comment and CRLF tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** State the in-place and whole-section rules in the `adrHtmlHeld` doc comment and lock the PMK-323 cases with CRLF line ends.

**Architecture:** No behaviour change. One JSDoc rewrite in `scripts/lib/adr.mjs`, two CRLF test loops in `scripts/adr.test.mjs` after the fence CRLF loop (`a fence its container closes at ... is exempt with CRLF line ends too`).

**Tech Stack:** Node 22, plain ESM, `node:test` (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-15-pmk-326-html-held-comment-crlf-design.md` (approved by the coordinator).

## Global Constraints

- No code change other than the `adrHtmlHeld` JSDoc. A new test failing on develop's code is a bug: stop and `orca orchestration ask`.
- `adr-status` writes CRLF files back as LF (PMK-311, test `adr-status keeps CRLF line ends ...`): expected write is `text.replaceAll('\r\n', '\n').replace('Accepted', 'Deprecated')`.
- Every commit message carries `PMK-326` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scratch files under the session scratchpad, folder `PMK-326/`.

## Review Focus

- The mutation proof: each of the 30 new tests must turn red under at least one named CRLF mutation (Task 2 records which).
- None else: the inputs are the closed set the issue lists (5 kinds x 2 containers x 2 endings, plus 5 x 2 controls).

---

### Task 1: CRLF tests

**Files:**
- Test: `scripts/adr.test.mjs` (after the fence CRLF loop, before `// The guards still refuse when the whole section is replaced`)

- [ ] **Step 1: Write the tests**

Loop A, 20 cases: for `opener` of `['<!--', '<?php', '<![CDATA[', '<!X', '<script>']`, container `[quote '> ', '> ']` / `[list item '- ', '  ']`, ending `''` / `'\r\n'`, text `## Status\r\n\r\nAccepted\r\n\r\n${first}${opener}\r\n${rest}## X${end}`. Test name: `an HTML block ${opener} a ${container} holds at the end of the file ${how} is written in place with CRLF line ends too, real and dry run, with no note in adr-get (PMK-326)`. Assertions: `adrHtmlHeld(text) === null`; `adr-get` status `Accepted`, notes `[]`, `htmlHeld` null; dry run code 0 and `after` equals the LF write; file unchanged after dry run; real run code 0 and file equals the LF write.

Loop B, 10 cases: text `## Status\r\n\r\nAccepted\r\n\r\n${opener}\r\n## X${end}`. Name: `the HTML guard still refuses an unclosed top-level ${opener} block ${how} with CRLF line ends (PMK-326)`. Assertions: `adrHtmlHeld(text)` deep-equals `{ opener, lines: ['## X'] }`; dry and real runs code 2 with message exactly `docs/adr/0001-a.md: setting the status would delete "## X", which the HTML block "${opener}" takes into the Status section; nothing was written`; file unchanged; `adr-get` `htmlHeld` deep-equals the same object.

- [ ] **Step 2: Run** `node --test --test-name-pattern="PMK-326" scripts/adr.test.mjs`. Expected: 30 pass (behaviour already correct; the red phase is Task 2's mutation run).

- [ ] **Step 3: Commit** `test: CRLF variants of the PMK-323 HTML container cases (PMK-326)`.

### Task 2: Mutation proof (outside the repo)

- [ ] **Step 1:** Copy the worktree to `scratchpad/PMK-326/mut` (no `.git`), mutate `adrText` in the copy to keep `\r` (`.replaceAll('\r\n', '\n')` removed), run the PMK-326 tests there, record pass/fail counts. If any new test survives, add a second mutation (e.g. normalize only after the walk) and record it.
- [ ] **Step 2:** Record the mutations and counts for the PR body.

### Task 3: Doc comment

**Files:** Modify `scripts/lib/adr.mjs` (JSDoc above `export function adrHtmlHeld`).

- [ ] **Step 1:** Rewrite the JSDoc: in place (a top-level status line, `replacesInPlace`), only lines of `held.openHtml`, the kind 1 to 5 block directly in the document still open at the end of the walk, are named (PMK-323); one a quote or list item holds ends with its container. In a whole-section replacement, the heading-like lines of any HTML block and the late lines (after a blank line) of `held.unclosed`, the innermost kind 1 to 5 block that never closes, in a quote or list item too. Keep the `{ opener, lines }` and "reading is unchanged" sentences.
- [ ] **Step 2:** `git diff scripts/lib/adr.mjs` shows only comment lines. Commit `docs: say the in-place rule in the adrHtmlHeld comment (PMK-326)`.

### Task 4: Ship

- [ ] CHANGELOG line under `## Unreleased`; `npm test` foreground, exit 0; `/utils:review-work`; check criteria 1 and 2 (`issues update PMK-326 --check <n>`, dry run then real); commit `.issues/`; `pr open`, `issues comment`, `issues move PMK-326 in_review` through the pmkit CLI.
