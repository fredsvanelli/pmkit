---
id: PMK-21
title: Add the risk-radar command
type: feature
status: done
priority: medium
estimate: 5
assignee: fred
parent: EPC-3
milestone: phase-2-commands
branch: pmk-21-add-the-risk-radar-command
created: 2026-10-25T19:13:20Z
updated: 2026-10-27T14:21:15Z
---

## Description

Source: Unified model, EM catalog (`risk-radar`: "Blockers, stalled issues and PRs, late deliverables, broken CI"; degradation "Issues stalled by time"); Linear tab ("projects at risk or without updates").

## Acceptance criteria

- [x] Lists blockers, stalled issues, stalled PRs, late epics, epics without a recent status update and broken CI
- [x] Without a git host it lists issues stalled by time, and says so
- [x] Writes nothing
