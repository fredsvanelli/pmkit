---
id: PMK-158
title: Make next steps runnable and keep upgrade working across config shapes
type: task
status: in_review
priority: low
assignee: fred
parent: EPC-1
related: [PMK-118, PMK-120]
milestone: local-gaps
branch: pmk-158-make-next-steps-runnable-and-keep
created: 2026-10-28T00:11:39.454Z
updated: 2026-11-22T04:48:50Z
---

## Description

Found in PMK-118 and PMK-120. Error next steps that name a CLI command have no runnable form. `/pmkit:upgrade` step 5 would be blocked by a future change to the shape of `.pmkit/config.yaml`, because every write now refuses on an invalid file.

## Acceptance criteria

- [x] The conventions say how to run a next step that names a CLI command, and a test checks that every such next step names a real command
- [x] `migrate`, and so `/pmkit:upgrade` step 5, runs when `.pmkit/config.yaml` has problems other than the tracker system and path, and warns about them
