---
id: PMK-109
title: Issues created in the same second lose their creation order
type: bug
status: in_review
priority: high
estimate: 2
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-dz9q-issues-created-in-the-same-second-lose
created: 2026-10-25T19:16:21Z
updated: 2026-10-25T19:25:52Z
---

## Description

`created` and `updated` have second precision, and the `created` sort breaks ties by ID. Found while importing the requirements: 108 issues created in 6 seconds, up to 23 per second. `issues list` returned them by ID, so `/pmkit:cycle:plan`, which picks issues in creation order, would draft the wrong scope. `epic list` also lists epics by ID.

Repro: create several issues within one second, then run `issues list`. They come back by ID, not oldest first.

## Acceptance criteria

- [ ] `issues list` keeps creation order for issues created in the same second
- [ ] `epic list` keeps creation order for epics with the same start date or no start date
