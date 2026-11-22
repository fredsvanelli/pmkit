---
id: PMK-165
title: Treat canceled issues the same way in cycle close and closeCycle
type: bug
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-121, PMK-122]
milestone: local-gaps
branch: pmk-165-treat-canceled-issues-the-same-way-in
created: 2026-10-28T00:11:40.872Z
updated: 2026-11-22T05:16:00Z
---

## Description

Found in PMK-121 and PMK-122. `/pmkit:cycle:close` step 3 counts every issue not in `done` as unfinished, so a `canceled` one reaches step 6, while `closeCycle` leaves canceled issues out. Step 6's question does not name `AskUserQuestion`, while steps 1 and 7 do.

## Acceptance criteria

- [x] `/pmkit:cycle:close` leaves a canceled issue out of the unfinished issues and the carry-over, as `closeCycle` does, and proposes nothing for it
- [x] Step 6 asks its question with `AskUserQuestion`
- [x] The cycle-close scenario runs with a canceled issue in the sprint
