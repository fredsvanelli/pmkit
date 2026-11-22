---
id: PMK-160
title: Let a cycle close rerun find and finish every half-done split
type: bug
status: in_progress
priority: medium
assignee: fred
parent: EPC-1
related: [PMK-121, PMK-123]
milestone: local-gaps
branch: pmk-160-let-a-cycle-close-rerun-find-and-finish
created: 2026-10-28T00:11:39.878Z
updated: 2026-11-22T05:44:46Z
---

## Description

Found in PMK-121 and PMK-123. When a split's create succeeds and its `related` link fails, a second run of `/pmkit:cycle:close` cannot find the new issue, because nothing marks it with its origin. When a split fails at the move to `done`, a second run may be refused because the original's estimate already dropped to the delivered part.

## Acceptance criteria

- [x] A split whose create ran but whose `related` link did not is found by a second run of `/pmkit:cycle:close`, through a marker the create writes, and finished without a second create
- [x] A split that failed at the move to `done` after its estimate update is finished by a second run, with no estimate update and no refusal
- [x] A cycle-close scenario finishes such a half-done split
