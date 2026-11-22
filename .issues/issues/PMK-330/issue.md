---
id: PMK-330
title: Lock the PMK-326 CRLF cases against fences and share the HTML openers
type: chore
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-330-lock-the-pmk-326-crlf-cases-against
created: 2026-11-15T23:21:51.203Z
updated: 2026-11-22T02:55:21Z
---

## Description

### Context

PMK-326 (PR #301) locked the PMK-323 cases with CRLF line ends and wrote the in-place and whole-section rules in the `adrHtmlHeld` doc comment. Its reviews left gaps, checked at b3533a59:

- The CRLF in-place tests (`scripts/adr.test.mjs`, the loop over `HTML_KINDS`) do not check that `adrFenceHeld`, `adrFenceBlocks` and the `adr-get` `fenceHeld` are null, as the LF PMK-323 tests do (`assert.equal(adrFenceHeld(text), null)` in that loop).
- The CRLF controls cover only a bare top-level block that never closes, not the PMK-323 control of a top-level block of kind 1 to 5 that never closes after a block of the same kind its quote or list item holds.
- `HTML_KINDS` and `ENDINGS` repeat the opener and ending lists the LF PMK-323 loops write inline (twice).
- The PMK-326 line of `CHANGELOG.md` still calls `held.unclosed` any block of kind 1 to 5 that never closes, without the quote rule the doc comment now gives (a quote only when it runs to the last line of a file with no final newline).
- The doc comment says `held.unclosed` can be one a list item holds; a list item inside a quote follows the quote rule (`> - <!--` ... gives no late lines with a final newline and `>   bar` without one), which only the parenthesis covers.

Source: PMK-326 (PR #301, review cycles 1 and 2).

### Scope (in)

- The fence null checks in the CRLF in-place tests, and a CRLF control for the top-level block after a block of the same kind in a quote or list item.
- One list of openers and endings shared by the LF and CRLF loops.
- The CHANGELOG line and the doc comment say the quote rule, also for a list item in a quote.

### Out of scope

- Any change of behaviour.

### Tasks

- [ ] Add the fence null checks and the CRLF control
- [ ] Share the opener and ending lists
- [ ] Fix the CHANGELOG line and the doc comment

## Acceptance criteria

- [x] The CRLF in-place tests check that `adrFenceHeld`, `adrFenceBlocks` and `adr-get` `fenceHeld` are null, and a CRLF control for a top-level block of kind 1 to 5 that never closes after a block of the same kind its quote or list item holds still refuses, real and dry run, with tests
- [x] The LF and CRLF loops use one list of openers and endings, with the same test names and count as before, and no other test changes
- [x] The PMK-326 CHANGELOG line and the `adrHtmlHeld` doc comment state the quote rule, also for a list item in a quote; no code line changes outside the tests
