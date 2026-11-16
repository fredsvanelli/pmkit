# End an ADR's Status section at every heading form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `locate().end` in `scripts/lib/adr.mjs` ends the `## Status` section at setext, indented, tab and empty headings, not only at `#{1,6} `.

**Architecture:** Replace the one-line ATX test inside `end` with a helper `headingStarts(lines, code, from)` that returns the index of the first heading start after `from`. `adrInfo` and `setAdrStatus` keep calling `locate().end`, so one parser serves `adr-get` and `adr-status`.

**Tech Stack:** Node, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-273-status-section-heading-forms-design.md`

## Global Constraints

- One status parser (PMK-263): no second copy of the heading rule.
- CRLF is already normalised by `adrText`; the helper sees `\n` lines.
- Every commit message carries `(PMK-273)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- `---` after a blank line (thematic break) keeps the section open (AC 4).
- `#hashtag` and a 4-space-indented `# x` are not headings.
- Multi-line paragraph over `===`: the section ends at the paragraph's first line.
- `Accepted\n---` right under the status text ends the section with an empty status.
- A `---` under a list item or quote is not a heading.
- Fenced `===` or `---` lines never end the section.

---

### Task 1: Heading forms in `locate().end`

**Files:**
- Modify: `scripts/lib/adr.mjs` (`locate`, `end`)
- Test: `scripts/adr.test.mjs` (after the PMK-269 test)

**Interfaces:**
- Produces: `end(from) -> number` unchanged contract (index of the line where the section stops, `lines.length` when none).

- [ ] **Step 1: Write failing tests**
  - `adrInfo` and `setAdrStatus` table test: for each of setext `===`, setext `---` directly under the status text, a three-line paragraph over `===`, ` ## H`, `   ## H` (three spaces), `##\tH`, `##` alone, `#` alone: `adrInfo(text).status === 'Accepted'` (or `''`-case as below), `setAdrStatus(text, 'deprecated').text` equals the input with only the status line changed (heading and text under it kept), and `setAdrStatus(text, 'accepted').text === text`.
  - Not headings: `    ## H` (4 spaces), `#hashtag`, `Accepted\n\n---\n\nmore` (thematic break after a blank line), `- item\n---`, `> quote\n===`, fenced `===`/`---` lines: `adrInfo(text).status` includes the extra text.
  - CLI test (reuse the helpers near `adrGetFrom`/`adrStatus`): `docs adr-get` and `docs adr-status` on one repository ADR with a setext heading after the status, asserting JSON status and the written file.
- [ ] **Step 2: Run** `node --test scripts/adr.test.mjs` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `locate`: `ATX = /^ {0,3}#{1,6}([ \t]|$)/`, `UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/`. `end(from)` scans `i > from`, skipping fenced lines: an ATX line ends at `i`; an UNDERLINE line at `i` whose line `i-1` is non-blank, not fenced, not an ATX line, and `i-1 > from` ends the section at the paragraph start (walk back while the line above is non-blank, not fenced, `> from`), provided the start has indent <= 3 and does not begin with `>`, `[-*+] ` or `\d+[.)] `.
- [ ] **Step 4: Run** `node --test scripts/adr.test.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(adr): end the Status section at setext, indented, tab and empty headings (PMK-273)`.

### Task 2: Docs, changelog, issue criteria

**Files:** `CHANGELOG.md`, `.issues/` (via CLI)

- [ ] **Step 1:** Add a line at the top of `## Unreleased` in the style of the PMK-269 line. No new command, so README and SKILL tables stay.
- [ ] **Step 2:** `node scripts/pmkit.mjs issues update PMK-273 --check <n>` for n = 1..4 (dry-run, then real); commit `.issues/`.
- [ ] **Step 3:** `npm test` in the foreground, exit code 0.
