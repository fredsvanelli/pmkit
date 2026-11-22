---
id: PMK-159
title: Stop cycle close from proposing moves it cannot run on an invalid config
type: bug
status: in_review
priority: medium
assignee: fred
parent: EPC-1
related: [PMK-120]
milestone: local-gaps
branch: pmk-159-stop-cycle-close-from-proposing-moves-it
created: 2026-10-28T00:11:39.689Z
updated: 2026-11-22T05:36:24Z
---

## Description

Found in PMK-120. With an invalid `.pmkit/config.yaml`, `/pmkit:cycle:close` step 6 proposes moves that step 7 cannot run, because writes refuse. Step 1 says to stop and later to show the report. Decide what close does with an invalid config and say it in one place.

## Acceptance criteria

- [x] `/pmkit:cycle:close` says in one place what it does with an invalid `.pmkit/config.yaml`: a report of the reads, with no proposal of moves it cannot run and no question
- [x] Step 1 points to that rule instead of holding its own
- [x] A cycle-close scenario runs it: the sync dry run fails, the reads run, nothing is written
