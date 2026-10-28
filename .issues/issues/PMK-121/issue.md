---
id: PMK-121
title: Count done issues moved during a late cycle close in velocity
type: bug
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-1
related: [PMK-113, PMK-160, PMK-165, PMK-166]
milestone: local-gaps
branch: pmk-121-count-done-issues-moved-during-a-late
created: 2026-10-26T17:58:03.634Z
updated: 2026-10-28T00:11:41Z
---

## Description

Found in PMK-113. `scripts/lib/metrics.mjs` counts a done issue in velocity only when its move date (UTC) is on or before the sprint's `end`. `/pmkit:cycle:close` usually runs on or after the end date, so a split original moved to `done` there, or an issue that `pr sync` moves in step 1, counts 0 while the retro reports its points. `cycle:plan` and `report:status` read the same metrics.

## Acceptance criteria

- [ ] An issue of the sprint moved to `done` after the sprint's `end` but before the sprint is closed (by `pr sync` or by the split in `/pmkit:cycle:close`) counts in that sprint's velocity, with its points and in the count, as the `cycle:close` report shows it
- [ ] An issue moved to `done` after its sprint is closed does not count in that closed sprint
- [ ] `metrics velocity`, `/pmkit:cycle:plan` and `/pmkit:report:status` read the same rule, so their numbers agree with the `cycle:close` report
- [ ] Tests cover a move to `done` before the end, between the end and the close, and after the close, and `npm test` passes
