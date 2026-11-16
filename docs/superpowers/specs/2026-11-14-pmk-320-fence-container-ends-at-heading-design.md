# PMK-320: write in place past a fence its container closes at the heading or the end of the file

Short design (a small change). The coordinator chose the approach; the questions of brainstorming were skipped on purpose.

## Intent

Since PMK-317 a fence in a quote or list item is written in place (and `adr-get` gives no note) only when a non-blank line of the section comes after the line where its container ends. When the container ends at the blank line before `## Context`, at the heading itself (ATX or setext) or at the end of the file, `adr-status` still refuses and `adr-get` still notes it, though CommonMark closes the fence there and the in-place write replaces one line and keeps all others. The HTML guard already writes these cases in place with no note.

## Goals

- A fence in a quote or list item is closed whenever its container ends, whatever ends it, on the in-place write: no refusal, no `adr-get` note, real and dry run.

## Non-goals

- Whole-section replacement (status in an item or quote, no known status line, two status lines): the guard keeps refusing.
- A top-level fence that does not close: it keeps refusing.
- Which line is the status and the refusal names (PMK-319).
- The HTML guard (see follow-ups in the PR).

## Approaches

1. **Mirror the HTML guard (chosen).** The HTML guard names an unclosed block in place only when it is still open at the end of the walk (`held.unclosed`). A fence needs the same: in place, name only the top-level fence that is still open at the end of the walk (`held.openFence`: the last open block, a fence directly in the document). A container ends a fence, so a fence in a quote or item is never still open at the end of the section. This deletes the `dropped`/`ended`/`droppedAt` bookkeeping of PMK-317, so there is one way to find the end of a container: the walk.
2. Keep `ended` and relax its test from "a non-blank line of the section from the drop on" to "any line from the drop on". Keeps a second mechanism next to `held.unclosed`, and the end of the file (no line drops the fence when the file has no final newline) needs a special case anyway.
3. Judge by text in `fenceRisk` (is there a heading after the fence?). A second way to find the end of the container: rejected by the coordinator.

## Design

- `sectionEnd` (`scripts/lib/adr.mjs`): at the end of the walk set `held.openFence` to the last open block when it is a fence directly under the document (`open.length === 2`), else `null`. It is only reached when no top-level heading ended the section; a top-level fence that never closes swallows every later line, so it always gets there. Drop `dropped`, `droppedAt`, `ended` and the body of `finish`.
- `fenceRisk`: in place, a heading-like line of a fence is named only when its block is `held.openFence`. Whole-section replacement names every one, as before.
- A closed top-level fence (`closer`) is never open at the end, so it is exempt as before.

## Tests

- Change the PMK-314 tests that pin the refusal for a container that closes at the heading, at the blank line before it, at a setext heading or at the end of the file (quote and item, ATX and setext, with and without a final newline): written in place, real and dry run, no note. The reason in the test: CommonMark ends the fence with its container, and the in-place write keeps every line (PMK-320).
- Keep: top-level unclosed fence refuses; whole-section replacements refuse (item or quote status, no known status line, two status lines, status after the fence).
- An item that a blank line and an indented line keep open up to the heading: written in place (the container ends at the heading).
- A top-level fence after a container that closed is not the container's: still refuses when it never closes.

## Proof

Develop against branch on random Status bodies checked against commonmark.js 0.31.2 (refusal, written text, what `adr-get` reads), and `node scripts/dev/adr-commonmark-diff.mjs` in full: 0 worse. Both in the PR.

## Docs

`commands/spec/adr-status.md`, ADR 0006 (the `adr-get` note), README row for `docs adr-status`, CHANGELOG.
