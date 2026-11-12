---
id: PMK-283
title: Test adr-status on a status followed by a setext underline
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-283-test-adr-status-on-a-status-followed-by
created: 2026-11-12T02:12:44.131Z
updated: 2026-11-12T03:50:00Z
---

## Description

### Context

PMK-273 reads `## Status\nAccepted\n---` (no blank line) as a setext heading, as CommonMark does, and says so in the CHANGELOG. Only `adrInfo` has an assertion for it; `setAdrStatus` does not, so what `docs adr-status` writes there is not fixed by a test. Source: PMK-273, PR #227.

### Scope (in)

- A test of `setAdrStatus` (and `docs adr-status`) on `## Status\nAccepted\n---`, fixing what it writes.

### Out of scope

- Changing the setext rule.

### Tasks

- [ ] Add the test

## Acceptance criteria

- [ ] A test fixes what `docs adr-status` writes on a Status section whose text is underlined with `---`
