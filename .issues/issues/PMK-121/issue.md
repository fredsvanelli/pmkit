---
id: PMK-121
title: Count done issues moved during a late cycle close in velocity
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-113]
milestone: local-gaps
created: 2026-10-26T17:58:03.634Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-113. `scripts/lib/metrics.mjs` counts a done issue in velocity only when its move date (UTC) is on or before the sprint's `end`. `/pmkit:cycle:close` usually runs on or after the end date, so a split original moved to `done` there, or an issue that `pr sync` moves in step 1, counts 0 while the retro reports its points. `cycle:plan` and `report:status` read the same metrics.
