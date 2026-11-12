---
id: PMK-281
title: Match CommonMark on which lines interrupt the Status paragraph
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T02:12:43.954Z
updated: 2026-11-12T02:12:43Z
---

## Description

### Context

PMK-273 stops the setext paragraph walk at `INTERRUPTS_PARAGRAPH` (`scripts/lib/adr.mjs:117`). In CommonMark an ordered list interrupts a paragraph only when it starts at `1`, and an empty list item does not interrupt one. The regex accepts `2. foo` and a lone `-`. A tab-indented code line also keeps the section open (`scripts/lib/adr.mjs:164`). Source: PMK-273, PR #227.

### Scope (in)

- `Accepted\n2. foo\n===` ends the section at `Accepted`.
- A lone `-` does not interrupt the paragraph.
- `Accepted\n\n\tcode\nmore\n===` is read as CommonMark reads it.

### Out of scope

- Tables and HTML blocks.

### Tasks

- [ ] Tighten INTERRUPTS_PARAGRAPH
- [ ] Handle the tab-indented line
- [ ] Test each case

## Acceptance criteria

- [ ] `2. foo` and a lone `-` do not interrupt the paragraph, with a test
- [ ] A tab-indented code line before a setext underline is read as CommonMark reads it, with a test
