---
id: PMK-259
title: Unarchive issues on Linear
type: feature
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-5
branch: pmk-259-unarchive-issues-on-linear
created: 2026-11-11T22:34:42.693Z
updated: 2026-11-22T17:09:08Z
---

## Description

### Context

PMK-250 added unarchive on the Local tracker. On Linear, `issues unarchive` and `issues bulk unarchive` answer `NOT_SUPPORTED`, although Linear has `issueUnarchive` for archived issues that are not in the trash. Suggested by the PMK-250 implementer. Source: PMK-250, PR #205.

### Scope (in)

- `issues unarchive` and `issues bulk unarchive` on Linear for archived issues, with the same dry run and preview as the Local tracker.

### Out of scope

- Issues in Linear's trash, which `issues restore` covers.

### Tasks

- [ ] Bring an archived Linear issue back
- [ ] Bring a set of archived Linear issues back in one bulk change

## Acceptance criteria

- [x] `issues unarchive` on an archived Linear issue brings it back into `issues list`, and `--dry-run` sends no request
- [x] `issues bulk unarchive --archived` with a filter brings back every archived Linear issue it matches, after the usual preview
- [x] Unarchiving a Linear issue that is not archived changes nothing and says so
- [x] An issue in Linear's trash is refused with a message that points to `issues restore`
