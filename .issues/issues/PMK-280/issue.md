---
id: PMK-280
title: Keep the Status section open past an indented list item continuation
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-280-keep-the-status-section-open-past-an
created: 2026-11-12T02:12:43.866Z
updated: 2026-11-12T04:01:16Z
---

## Description

### Context

PMK-273 ends an ADR's `## Status` section at a setext heading and walks back to the start of its paragraph (`scripts/lib/adr.mjs:164-174`). An indented continuation line of a list item, followed right away by `---`, is taken for the setext paragraph, so the section ends there. Source: PMK-273, PR #227.

### Scope (in)

- `## Status\n\nAccepted\n\n- a\n\n  b\n---` keeps `b` and the `---` in the section, as CommonMark reads them (the continuation belongs to the list item and `---` is a thematic break).
- `adr-status` no longer leaves `b` and `---` under the new status.

### Out of scope

- A full CommonMark list parser.

### Tasks

- [ ] Stop the paragraph walk at a list item continuation
- [ ] Test adr-get and adr-status

## Acceptance criteria

- [x] `docs adr-get` with a list item continuation right before `---` in the Status section shows the whole section, with a test
- [x] `docs adr-status` rewrites the status without leaving that text below it, with a test
