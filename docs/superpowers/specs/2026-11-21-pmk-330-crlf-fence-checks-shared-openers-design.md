# PMK-330: lock the PMK-326 CRLF cases against fences and share the HTML openers

## Problem

PMK-326 locked the PMK-323 HTML cases with CRLF line ends. Its reviews left gaps:

- The CRLF in-place loop (`scripts/adr.test.mjs`, the `HTML_KINDS` loop) does not check `adrFenceHeld`, `adrFenceBlocks` and the `adr-get` `fenceHeld`, as the LF loop does.
- The CRLF controls cover only a bare top-level block that never closes, not the PMK-323 control: a top-level block of kind 1 to 5 that never closes, after a block of the same kind that a quote or list item holds.
- `HTML_KINDS` and `ENDINGS` repeat the opener and ending lists that the LF loops write inline, twice.
- The PMK-326 line of `CHANGELOG.md` (0.6.0) and the `adrHtmlHeld` doc comment leave out the quote rule for `held.unclosed`, and the doc comment does not say that a list item inside a quote follows it.

The behaviour is right. Checked at `d03d6a94`: `> - <!--`, `>`, `>   bar` gives `adrHtmlHeld` null with a final newline, and `>   bar` without one, the same as `> <!--`. It does not follow a top-level list item, which names `bar` with a final newline.

## Approaches

1. **Hoist one list of openers, containers and endings above the first LF loop, and write the line end per loop** (chosen). `HTML_KINDS`, `HTML_CONTAINERS` (`quote` and `list item`, with their first and later prefixes) and `ENDINGS` (`['', 'with no final newline'], ['\n', 'with a final newline']`). The CRLF loop maps `\n` to `\r\n`. Test names and counts stay the same.
2. Parameterize one loop over the line ends. That would merge the LF and CRLF tests and change their names, and the issue asks for the same names and count.

## Design

- `scripts/adr.test.mjs`:
  - `HTML_KINDS`, `HTML_CONTAINERS` and `ENDINGS` are defined once, before the PMK-314 in-place table that holds the PMK-323 rows. The two inline lists in the LF rows (the in-place rows and the guard rows) and the PMK-326 loops use them.
  - The CRLF in-place loop adds `assert.equal(adrFenceHeld(text), null)`, `assert.deepEqual(adrFenceBlocks(text), [])` and `assert.equal(get.data.fenceHeld, null)`.
  - A new CRLF control loop, for each opener and each container, with and without a final newline: `## Status`, `Accepted`, the block in the container holding `## Y`, blank, the top-level block holding `## X`. It refuses real and dry run with the HTML message naming `## X`, and leaves the file unchanged. The test name follows the PMK-326 control's.
- `scripts/lib/adr.mjs`: only the `adrHtmlHeld` doc comment. `held.unclosed` names a block a list item holds outside a quote. A block in a list item inside a quote follows the quote rule.
- `CHANGELOG.md`: the PMK-326 line (0.6.0) says `held.unclosed` takes a quote's block only when the quote runs to the last line of a file with no final newline, and a list item in a quote follows the quote. The Unreleased section gets a PMK-330 line.

## Checks

- The test count goes up only by the new CRLF controls: 5 openers × 2 containers × 2 endings = 20. The fence assertions go into existing tests. The names of the existing tests are unchanged; checked by listing test names before and after.
- The new assertions fail when broken: a mutation that makes `adrFenceBlocks` return a fence for CRLF bodies fails them. Shown in the PR.
- `git diff --stat` shows no code line outside the tests changes in `scripts/lib`, only the comment.

## Interview

- Does editing a released CHANGELOG line (0.6.0) break anything? `changelog.test.mjs` parses versions and bodies and does not pin the text. The issue asks for the edit.
- New terms or ADRs: none.
- Approval: there is no product question and the acceptance criteria are exact, so the design is approved under the owner's rule.
