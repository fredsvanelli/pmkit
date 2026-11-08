---
id: PMK-68
title: Add the prioritize-by-demand command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
blocked_by: [PMK-46]
related: [PMK-204]
milestone: generic-commands
branch: pmk-68-add-the-prioritize-by-demand-command
created: 2026-10-25T19:13:22Z
updated: 2026-11-08T03:15:27Z
---

## Description

Source: Unified model, PM catalog (`prioritize-by-demand`: "Ranks by customer or user impact"; degradation "Comments and mentions as signal"); Linear tab ("Adjusts priority after confirmation").

## Acceptance criteria

- [x] Ranks issues by demand signals
- [x] Without demand signals it uses comments and mentions, and says so
- [x] Changes priorities after a full preview
