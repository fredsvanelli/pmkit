---
id: PMK-282
title: Find an indented or closed Status heading
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-282-find-an-indented-or-closed-status
created: 2026-11-12T02:12:44.044Z
updated: 2026-11-12T04:01:18Z
---

## Description

### Context

PMK-273 made the end of the Status section and the title use one heading helper, `headingLevel` (`scripts/lib/adr.mjs:114`), which accepts up to three spaces of indentation. The `## Status` heading itself is still found with `STATUS_SECTION` (`scripts/lib/adr.mjs:110`), which needs `##` at the start of the line and no closing `#` sequence. Source: PMK-273, PR #227.

### Scope (in)

- ` ## Status` (one to three spaces) and `## Status ##` are found as the Status section by `docs adr-get` and `docs adr-status`.

### Out of scope

- Setext `Status` headings.

### Tasks

- [ ] Find the Status heading with the shared heading rules
- [ ] Test adr-get and adr-status

## Acceptance criteria

- [x] `docs adr-get` reads the status under ` ## Status` and `## Status ##`, with a test
- [x] `docs adr-status` rewrites it in place, with a test
