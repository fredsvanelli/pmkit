---
id: PMK-293
title: Read the ADR title with the same closing rule as the Status heading
type: bug
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-293-read-the-adr-title-with-the-same-closing
created: 2026-11-12T14:41:35.371Z
updated: 2026-11-12T19:26:34Z
---

## Description

### Context

PMK-282 reads the `## Status` heading with `headingText`, which drops a closing `#` sequence. The title still drops only the opening (`scripts/lib/adr.mjs:239`), so `# 5. Use X #` gives the title `5. Use X #`. The review also found no test for `## Status #`, `## Status # #` and `## Status \#`, which behave correctly. Source: PMK-282, PR #235 (review).

### Scope (in)

- The title drops a closing `#` sequence with `headingText`.
- Tests for the three Status heading forms above.

### Out of scope

- Setext titles.

### Tasks

- [ ] Use headingText for the title
- [ ] Add the Status heading tests

## Acceptance criteria

- [x] `# 5. Use X #` gives the title `5. Use X`, with a test
- [x] `## Status #` is the Status section, and `## Status # #` and `## Status \#` are not (only the last `#` run closes a heading, as in CommonMark), with a test
