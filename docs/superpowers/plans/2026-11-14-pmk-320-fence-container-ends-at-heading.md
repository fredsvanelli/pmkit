# PMK-320 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, the coordinator chose it) to implement this plan task-by-task.

**Goal:** `adr-status` writes in place, and `adr-get` gives no note, past a fence its quote or list item closes at a blank line before the heading, at the heading or at the end of the file.

**Architecture:** In place, the fence guard names a fence only when it is still open at the end of the walk that ends the section and sits directly in the document, as the HTML guard does with `held.unclosed`. This replaces the `dropped`/`ended` bookkeeping of PMK-317.

**Tech Stack:** Node 22, `node:test`, commonmark.js 0.31.2 (outside the repo, for the proof).

**Spec:** `docs/superpowers/specs/2026-11-14-pmk-320-fence-container-ends-at-heading-design.md`

## Global Constraints

- Every commit message carries `(PMK-320)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Whole-section replacement and a top-level fence that never closes keep refusing.
- `npm test` runs in the foreground, exit code 0, Node 22.

## Review Focus

- A fence in a quote inside a list item, closed at the heading: written in place.
- A file with no final newline whose last lines are `> ```` ` and `> ## X`: written in place (the HTML guard refuses this one; not in scope).
- CRLF line ends with the same cases.
- A top-level unclosed fence after a container that closed: still refuses.
- A quote status or item status with such a fence: still refuses (whole-section replacement).

---

### Task 1: Tests first, then the guard

**Files:**
- Modify: `scripts/adr.test.mjs` (the PMK-314 groups near line 2157)
- Modify: `scripts/lib/adr.mjs` (`sectionEnd`, `fenceRisk`)

**Interfaces:**
- Produces: `held.openFence` (array property set by `sectionEnd`, like `held.unclosed`): the fence block directly in the document still open at the end of the walk, else `null`.

- [ ] **Step 1: Move the container-end cases to the in-place list.** In the "still refuses" list remove `a quoted fence a setext heading ends the section after (---)`, `... no blank line (---)`, `... (===)`, the three `an item fence a setext heading ...` cases, `an item fence the item closes only at the heading`, `a quoted fence open at the end of the file`, `an item fence open at the end of the file`, `an item fence kept open by an indented line up to the heading`, and `a fence a quote closes` (the plain one: `> ```, > ## X, blank, ## Context`). Add them to the in-place list (PMK-314 loop at "is written in place, real and dry run") with a comment saying why: CommonMark ends the fence with its container, so the heading that ends the section or the end of the file is not inside it, and the in-place write keeps every line (PMK-320). Add: the blank-line-before-heading case for quote and item, the heading with no blank line for quote and item, ATX and setext (`Foo`/`---`, `Foo`/`===`), the end of the file with and without a final newline, a quote in an item, and the CRLF variant.
- [ ] **Step 2: Add the kept refusals** to the "still refuses" list: `an unclosed top-level fence after a closed quote fence` (`Accepted`, blank, `> ```, > ## X`, blank, `` ``` ``, `## Y`), and keep every whole-section case already there (item or quote status, no known status line, two statuses, before the status).
- [ ] **Step 3: Run** `node --test scripts/adr.test.mjs` and check the moved cases FAIL.
- [ ] **Step 4: Implement.** In `sectionEnd`: delete `dropped`, `droppedAt` and the loop in `finish` (inline `finish(x)` as `x`, four call sites); at the tail set `held.openFence = open.length === 2 && open[1].type === 'fence' ? open[1] : null` next to `held.unclosed`. In `fenceRisk`: filter `!(inPlace && item.block !== held.openFence)` in place of the `closer`/`ended` test. Update the doc comments of both.
- [ ] **Step 5: Run** `node --test scripts/adr.test.mjs`. Expected: all pass.
- [ ] **Step 6: Commit** `fix(adr): write in place past a fence its quote or list item closes at the heading or the end of the file (PMK-320)`.

### Task 2: Proof

**Files:** none in the repo.

- [ ] **Step 1:** `npm install --prefix <scratch>/cm commonmark@0.31.2`.
- [ ] **Step 2:** Script in the scratchpad: random Status bodies (quote/item/top-level fences with `## X`, setext, blank lines, indented lines, `Date:` lines, status lines, EOF with and without newline), run on develop (`git worktree` at `origin/develop` or `git show origin/develop:scripts/lib/adr.mjs` into a temp dir) and on the branch: refused or not, the text written, what `adr-get` reads, checked against commonmark.js for where the section ends. Report bodies, divergences, and the set of new writes: only the issue's cases, no line deleted (every line of the old text still in the new one except the status line).
- [ ] **Step 3:** `node scripts/dev/adr-commonmark-diff.mjs` in full: 0 worse. If PMK-321 is in develop, use its `scripts/dev` and list the writes where the base refuses in the container cases.

### Task 3: Docs

**Files:** `commands/spec/adr-status.md`, `docs/adr/0006-adr-status-is-one-line-of-the-status-section.md`, `README.md`, `CHANGELOG.md`.

- [ ] **Step 1:** Update the text that says a container that ends only at the heading or the end of the file still refuses (ADR 0006 line 15, README `docs adr-status` row, the spec file), and add the CHANGELOG line under `## Unreleased` at the top. Commit.

### Task 4: Deliver

- [ ] `node scripts/pmkit.mjs issues update PMK-320 --check 1|2|3` (dry run then real), commit `.issues/`, `npm test` in the foreground (exit 0), PR, summary comment, `in_review`.
