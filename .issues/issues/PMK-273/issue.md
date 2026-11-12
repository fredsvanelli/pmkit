---
id: PMK-273
title: "End an ADR's Status section at every heading form"
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-273-end-an-adr-s-status-section-at-every
created: 2026-11-12T00:43:33.314Z
updated: 2026-11-12T01:23:00Z
---

## Description

### Context

PMK-269 ends an ADR's `## Status` section at the next ATX heading (`#` to `######` and a space, outside code blocks). Its review found heading forms that still do not end it. Source: PMK-269, PR #221.

### Scope (in)

- A setext heading (a line underlined with `===` or `---`) does not end the section (`scripts/lib/adr.mjs:144`).
- A heading indented by up to three spaces, a heading with a tab after the `#`, and an empty heading (`##` alone) do not end it either. CommonMark counts all of them as headings.
- `adr-status` then rewrites the text under them as part of the status and drops it.

### Out of scope

- A `---` that closes front matter.

### Tasks

- [ ] End the section at setext headings
- [ ] End the section at indented, tab and empty headings

## Acceptance criteria

- [x] `docs adr-get` shows only the status text when a setext heading follows it, with a test
- [x] `docs adr-get` shows only the status text when an indented, tab or empty heading follows it, with a test
- [x] `docs adr-status` keeps those headings and the text under them
- [x] A `---` line that is a thematic break with a blank line above it does not end the section
