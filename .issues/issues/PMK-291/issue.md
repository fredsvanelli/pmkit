---
id: PMK-291
title: Follow list nesting when a line continues a list item before an underline
type: bug
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-291-follow-list-nesting-when-a-line
created: 2026-11-12T14:41:35.198Z
updated: 2026-11-12T20:41:49Z
---

## Description

### Context

`continuesItem` (`scripts/lib/adr.mjs:192`) lets the nearest item whose content column fits decide, and skips code lines. Three ADR texts end the Status section in the wrong place:

- A wider sibling item: in `- x\n\n1. a\n\n  b\n---`, `b` is not inside `1. a` (content at column 3), so it is a paragraph and `---` makes it a heading; `- x` keeps the section open.
- A fence at column 0 ends the list: in `- a\n\n```\nz\n```\n  b\n---`, `b` is a paragraph and `---` makes it a heading; the walk back skips the fence and keeps the section open.
- A lazy continuation: in `- a\nlazy\n\n  b\n---`, `b` is inside the item and `---` is a thematic break; the walk stops at `lazy` and ends the section at `b`.

Source: PMK-280, PR #231 (review), carried by PMK-281, PR #234.

### Scope (in)

- The three texts above read as CommonMark reads them in `adrInfo`, `setAdrStatus`, `adr-get` and `adr-status`.
- Compare `adrInfo` of develop and of the branch over list cases before the PR, as PMK-281 did.

### Out of scope

- A full list parser.

### Tasks

- [ ] Stop the walk at a line that ends the list
- [ ] Let only the item that holds the line decide
- [ ] Test the three texts

## Acceptance criteria

- [x] A wider sibling item, a fence at column 0 and a lazy continuation each end the section where CommonMark puts the heading or the break, with a test each
