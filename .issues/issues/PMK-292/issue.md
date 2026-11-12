---
id: PMK-292
title: Read an empty list item and a long ordered marker as CommonMark does
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-292-read-an-empty-list-item-and-a-long
created: 2026-11-12T14:41:35.285Z
updated: 2026-11-12T20:41:50Z
---

## Description

### Context

`BLOCK_START` (`scripts/lib/adr.mjs:121`) treats any list marker as a block start. In `Accepted\n\n-\nfoo\n===`, the empty item does not hold `foo`, so `foo` is a paragraph and `===` makes it a heading, but the section stays open. An ordered marker has at most 9 digits, but `INTERRUPTS_PARAGRAPH`, `BLOCK_START` and `LIST_ITEM` accept more (`:119-125`), so `1234567890. a\nb\n---` keeps the section open. Source: PMK-281, PR #234 (reviews).

### Scope (in)

- `-\nfoo\n===` ends the section at `foo`.
- A marker of 10 or more digits is not a list item.

### Out of scope

- Other list cases.

### Tasks

- [ ] Handle the empty item
- [ ] Limit ordered markers to 9 digits
- [ ] Test both

## Acceptance criteria

- [x] An empty item followed by a line and a setext underline ends the section at that line, with a test
- [x] A 10-digit ordered marker is read as paragraph text, with a test
