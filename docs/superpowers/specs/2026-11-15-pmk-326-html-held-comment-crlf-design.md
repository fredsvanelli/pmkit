# PMK-326: say the in-place rule in the adrHtmlHeld comment and test HTML in a container with CRLF

Short design (chore, estimate 1). No behaviour change. Brainstorming questions were answered from the code at 97a3bd03.

## Intent

PMK-323 made the in-place write name an HTML block of kind 1 to 5 only when it is `held.openHtml`, the top-level block still open at the end of the walk. Two things lag behind:

- The `adrHtmlHeld` doc comment (`scripts/lib/adr.mjs`) still describes only the whole-section rule; the in-place rule is in an inline comment in the body.
- The PMK-323 tests are all LF. With CRLF the CLI already writes these cases in place (`adrText` turns `\r\n` into `\n` before the walk), but nothing locks it.

## Goals

- The doc comment states both rules: in place, only a line of `held.openHtml` (a block of kind 1 to 5 directly in the document, still open at the end of the walk); in a whole-section replacement, the heading-like lines of any HTML block, plus the late lines (after a blank line) of `held.unclosed`, the innermost block of kind 1 to 5 that never closes, in a quote or list item too.
- CRLF tests lock the PMK-323 cases and the top-level control.

## Non-goals

- Any code change other than the comment. If a CRLF test fails on develop's code, that is a bug: stop and ask the coordinator.
- `statusLineOf` / `paragraphOf` (PMK-325), `scripts/dev/` (PMK-327).

## Approaches

- **Chosen: a CRLF loop next to the fence CRLF loop, in the PMK-323 tests' style.** For each PMK-323 case with `\r\n` line ends: `adrHtmlHeld` null, `adr-get` status `Accepted`, no note and `htmlHeld: null`, `adr-status` dry run `after` and the real write equal to the text with the status word changed. The write normalizes line ends to LF, as the existing `adr-status keeps CRLF line ends` test (PMK-311) pins, so the expected text is `text.replaceAll('\r\n', '\n').replace('Accepted', 'Deprecated')`; that is why the cases do not go into the LF in-place loop, which expects `text.replace(...)`. A new loop pins the top-level control with CRLF: for each kind, with and without a final newline, `adrHtmlHeld` names `## X`, `adr-status` refuses real and dry run with exit 2 and `would delete "## X", which the HTML block "<opener>" takes into the Status section`, the file is unchanged and `adr-get` has `htmlHeld`.
- Rejected: extending the fence CRLF loop (`a fence its container closes at ... is exempt with CRLF line ends too`). It only checks the pure functions; the issue asks for the CLI write and the `adr-get` note.
- Rejected: CLI tests in `scripts/cli.test.mjs`. `adr.test.mjs` already drives `adrStatus` and `adrGetFrom`; one file keeps the expected conflict with PMK-325 to `adr.test.mjs` and CHANGELOG.

## Design

- `scripts/lib/adr.mjs`: rewrite the `adrHtmlHeld` JSDoc only. The inline comment in the body stays (it gives the why).
- `scripts/adr.test.mjs`: after the fence CRLF loop, a loop of 20 in-place cases (5 kinds x quote/list item x final newline or not) and a loop of 10 top-level controls (5 kinds x final newline or not), both with `\r\n`. Existing lines unchanged.
- Tests that change on purpose: none. 30 new tests.

## Proof (acceptance criteria)

1. The doc comment: read in the diff.
2. The new tests pass on develop's code (`npm test`, exit 0, counts in the PR). Each would fail if CRLF handling broke: in a scratch copy of the worktree (outside the repo, `scratchpad/PMK-326/`), mutate `adrText` to keep `\r` and run `node --test scripts/adr.test.mjs`; the PR lists which new tests fail under each mutation (also: the quote and list prefix strip keeping `\r`), aiming for every new test failing under at least one. `git diff --stat` shows only the comment, the tests, the CHANGELOG line and the docs.

## Docs

CHANGELOG line under `## Unreleased`.
