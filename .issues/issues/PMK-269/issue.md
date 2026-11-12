---
id: PMK-269
title: "Keep subsections of an ADR's Status section"
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T00:00:31.526Z
updated: 2026-11-12T00:00:31Z
---

## Description

### Context

The second review of PMK-263 found that a `### ` heading inside an ADR's `## Status` section is read as part of the status. `develop` already behaved this way before PMK-263. Source: PMK-263, PR #216.

### Scope (in)

- `adr-get` reads `Accepted ### Notes more` as the status when `## Status` has a `### Notes` subsection (`scripts/lib/adr.mjs:147`, the end of the section).
- `adr-status` rewrites the whole section and drops the subsection.

### Out of scope

- Other status forms.

### Tasks

- [ ] End the status at the first heading of any level

## Acceptance criteria

- [ ] `docs adr-get` on an ADR whose `## Status` has a `### ` subsection shows only the status text
- [ ] `docs adr-status` keeps that subsection when it rewrites the status
