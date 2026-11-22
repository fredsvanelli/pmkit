# PMK-163: check paragraph indentation after list items in commands, skills and docs

## Problem

Found in PMK-124. In CommonMark, a line right after a list item, with no blank line between, that is not itself a list item and is indented less than the item's content column, is a lazy continuation: it joins the item's paragraph. PMK-124 fixed two such paragraphs in `pause.md` and `spec/import.md`, where a sentence meant for the outer step read as part of its last sub-item. Nothing stops the next one: a scan of `commands/`, `skills/` and `docs/` finds ten more today, four in command files (`backlog/request-queue.md:27`, `issues/investigate-bug.md:36`, `issues/review.md:29` and `:35`) and six in plans and specs.

## Goal

A static rule in `scripts/scenarios.test.mjs` fails on that shape, naming `file:line`, over every `.md` file under `commands/`, `skills/` and `docs/`; the ten places are fixed.

## Approaches

1. **A line scan (chosen).** For each list item line (`^( *)([-*+]|\d{1,9}[.)])( +)\S`), its content column is the width of the indent, the marker and the spaces. The next line fails the rule when it is not blank, not a list item, not a fence, table, heading or quote line, and its indent is at least 1 and less than the content column. Lines inside fenced code blocks are skipped. An indent of 0 is left out: the issue is about an indented paragraph, and a top-level line after a list is a separate, visible problem a reader sees in the source.
2. A CommonMark parse (the repo's own ADR parser) and a check of where each paragraph lands. Exact, but it would tie the rule to a parser written for ADR status lines, for a shape the line scan catches.

## Design

- `scripts/scenarios.test.mjs`: `lazyContinuations(text)` returns the 1-based line numbers; a test runs it over the three folders and asserts an empty list of `file:line`, and a unit test feeds it the PMK-124 shape (a hit), the same with a blank line (no hit), a line indented to the content column (no hit, it is the item's own continuation) and the shape inside a fence (no hit).
- The ten places get a blank line before the paragraph, which keeps it in the outer item, as PMK-124 did. Each one reads as meant for the outer item (a sentence about the whole step after its sub-list).
- CHANGELOG.

## Interview

- Do the fixes change what a command says? No: the words stay; the blank line moves the sentence from the last sub-item to the step, where every one of the ten reads as meant.
- Do scenario tests read these steps? The harness parses steps and sub-steps by their numbers; a paragraph is not a step id, so the parsed ids do not change (the suite checks it).
- `skills/` holds `references/` too; the rule scans every `.md` under it.
- New terms or ADRs: none.
- Approval: the issue names the rule and its place; pmkit PO approves.
