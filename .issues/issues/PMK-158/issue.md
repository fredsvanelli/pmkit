---
id: PMK-158
title: Make next steps runnable and keep upgrade working across config shapes
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-118, PMK-120]
milestone: local-gaps
created: 2026-10-28T00:11:39.454Z
updated: 2026-10-28T00:11:39Z
---

## Description

Found in PMK-118 and PMK-120. Error next steps that name a CLI command have no runnable form. `/pmkit:upgrade` step 5 would be blocked by a future change to the shape of `.pmkit/config.yaml`, because every write now refuses on an invalid file.
