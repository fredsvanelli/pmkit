---
id: PMK-162
title: Cover a blocker already in the planned sprint in the cycle-plan scenario
type: task
status: in_review
priority: low
assignee: fred
parent: EPC-1
related: [PMK-123]
milestone: local-gaps
branch: pmk-162-cover-a-blocker-already-in-the-planned
created: 2026-10-28T00:11:40.357Z
updated: 2026-11-22T05:29:33Z
---

## Description

Found in PMK-123. `/pmkit:cycle:plan` step 5 counts a blocker as selected when it is already in the planned sprint that step 1 chose. Only a static test pins that sentence, because the `team` fixture has no planned sprint. Add a scenario or a fixture that runs it.

## Acceptance criteria

- [x] A cycle-plan scenario plans an existing planned sprint that holds an open blocker, and the issue it blocks stays in the scope and lands in that sprint
