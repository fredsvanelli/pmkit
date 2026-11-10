---
id: PMK-248
title: Fix adr-status on an unchanged section and on two status forms
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-248-fix-adr-status-on-an-unchanged-section
created: 2026-11-10T19:28:14.686Z
updated: 2026-11-10T21:46:57Z
---

## Description

### Context

The re-review of PR #196 (PMK-228) approved `docs adr-status` with two edge cases left over. Neither blocked the merge, but each writes an ADR wrongly: one changes a file whose status did not change, and the other leaves two different statuses in one ADR. Source: PMK-228, PR #196.

### Scope (in)

- A `## Status` section with no blank lines around it (`## Status\nAccepted\n## Context`) is rewritten with blank lines when the status stays the same, and the command says `set`. A lowercase body (`accepted`) also counts as a change.
- An ADR with a `status:` key in its front matter and also a `## Status` section only gets the front matter changed, so the section keeps the old status.

### Out of scope

- Other ADR status formats, which the re-review checked by hand.

### Tasks

- [ ] Leave an ADR untouched when its status does not change
- [ ] Change every status an ADR holds, front matter and section alike

## Acceptance criteria

- [x] Setting the status an ADR already has leaves the file unchanged and says nothing changed, whatever the blank lines or letter case of its `## Status` section
- [x] An ADR with a status in both its front matter and a `## Status` section shows the new status in both places after `docs adr-status`
