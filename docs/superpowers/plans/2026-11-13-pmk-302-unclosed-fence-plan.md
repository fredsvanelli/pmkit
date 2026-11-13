# PMK-302 Unclosed Fence Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan. Steps use checkbox syntax.

**Goal:** `docs adr-status` refuses to delete a heading that an unclosed code fence takes into the `## Status` section; `docs adr-get` says why.

**Architecture:** `sectionEnd` already tracks fences (closed only by the same character and at least the same length). It records the lines an open fence continues and the fence still open at the end of the file. A sibling of `adrHtmlHeld`, `adrFenceHeld`, reads that; `pmkit.mjs` refuses and notes the way it does for PMK-299.

**Tech Stack:** Node 22, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-13-pmk-302-unclosed-fence-design.md`

## Global Constraints

- Reading (`adrInfo`, where `sectionEnd` stops) does not change; `node scripts/dev/adr-commonmark-diff.mjs` must stay 0 worse / 0 fixed.
- Refusal is `INVALID_INPUT` with a next step, dry run included, nothing written.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; issue ID in every commit.

## Review Focus

- Fence with an info string (```js) unclosed: refused.
- 4-backtick fence "closed" by 3 backticks: still open, refused.
- Unclosed fence with no heading-looking line after it: writes as today.
- CRLF text: same result as LF.
- Closed fence holding `## x`: writes as before.

### Task 1: Guard and note

**Files:** Modify `scripts/lib/adr.mjs` (`sectionEnd`, new `adrFenceHeld`), `scripts/pmkit.mjs` (`runAdrGet`, `runAdrStatus`), `scripts/adr.test.mjs`, `CHANGELOG.md`.

**Interfaces:** Produces `adrFenceHeld(text) -> { opener, lines } | null`; `adr-get` data gains `fenceHeld` (same shape or null).

- [ ] Step 1: In `scripts/adr.test.mjs` after the PMK-299 block, add tests for the refused cases (``` and ~~~ before `## Context`, ```js, 4 backticks closed by 3, CRLF) asserting `adrFenceHeld`, `get.data.fenceHeld`, a note naming the fence, `adr-status` code 2 / `INVALID_INPUT` / next step for dry run and real run, file unchanged; and the writes-as-before cases (closed fence, closed ```js, unclosed with no heading after). Add `fenceHeld: null` to the exact `adr-get` data assertion (~line 725).
- [ ] Step 2: Run `node --test scripts/adr.test.mjs`; expect the new tests to FAIL.
- [ ] Step 3: Implement the recording in `sectionEnd` and `adrFenceHeld(text)` in `scripts/lib/adr.mjs`; the PMK-299 filter ignores fence entries.
- [ ] Step 4: Add the refusal after the HTML one in `runAdrStatus` and the field and note in `runAdrGet` (`FENCE_HELD_STEP`: close the fence with a line of the same character, at least as long).
- [ ] Step 5: Run `node --test scripts/adr.test.mjs`; expect PASS. Run the commonmark diff; expect 0 worse.
- [ ] Step 6: CHANGELOG line, check the acceptance criteria, commit.
