---
id: PMK-166
title: Refuse cycle add into a closed sprint and check closed in adapters
type: bug
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-121]
milestone: local-gaps
branch: pmk-166-refuse-cycle-add-into-a-closed-sprint
created: 2026-10-28T00:11:41.052Z
updated: 2026-11-22T04:50:15Z
---

## Description

Found in PMK-121. `cycle add` accepts an issue into a sprint whose state is `closed`. Adapters other than the local tracker have no validity check for the sprint's `closed` time, and an unparsable value would drop every issue from velocity.

## Acceptance criteria

- [ ] `cycle add`, `issues create --sprint` and `issues update --sprint` into a closed sprint fail with `CONFLICT` and write nothing on Local, Linear and GitHub
- [ ] Velocity counts a sprint whose `closed` time does not parse by its end date instead of dropping every issue
