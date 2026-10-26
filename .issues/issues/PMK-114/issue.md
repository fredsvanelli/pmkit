---
id: PMK-114
title: Accept --sprint current in issues create
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-1
related: [PMK-10, PMK-115, PMK-116, PMK-117]
milestone: local-gaps
branch: pmk-114-accept-sprint-current-in-issues-create
created: 2026-10-26T15:39:49.505Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-10. `issues create --sprint current` fails with `INVALID_INPUT`, while `issues list --sprint current` and `cycle add --to current` accept `current`. An agent that turns "add it to this sprint" into `--sprint current` gets an error on create only.

## Acceptance criteria

- [ ] `issues create --sprint current` puts the issue in the active sprint, and fails with a clear error when no sprint is active
- [ ] `issues update --sprint current` behaves the same way
