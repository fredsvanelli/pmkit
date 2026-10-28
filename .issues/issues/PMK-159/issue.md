---
id: PMK-159
title: Stop cycle close from proposing moves it cannot run on an invalid config
type: bug
status: backlog
priority: medium
parent: EPC-1
related: [PMK-120]
milestone: local-gaps
created: 2026-10-28T00:11:39.689Z
updated: 2026-10-28T00:11:39Z
---

## Description

Found in PMK-120. With an invalid `.pmkit/config.yaml`, `/pmkit:cycle:close` step 6 proposes moves that step 7 cannot run, because writes refuse. Step 1 says to stop and later to show the report. Decide what close does with an invalid config and say it in one place.
