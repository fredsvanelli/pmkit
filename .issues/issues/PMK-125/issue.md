---
id: PMK-125
title: "`pr sync` records the done time at sync, not at PR merge"
type: bug
status: backlog
related: [PMK-23]
created: 2026-10-27T19:32:47.239Z
updated: 2026-10-27T19:32:50Z
---

## Description

`pr sync` writes the move to `done` with the time it runs, not the time the PR merged. Velocity, cycle time and the closed-sprint cut in release notes then count an issue synced late in the wrong sprint. Use the PR's `mergedAt` as the event time when the host returns it.
