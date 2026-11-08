---
id: PMK-70
title: Add the request-queue command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
blocked_by: [PMK-46]
related: [PMK-207]
milestone: generic-commands
branch: pmk-70-add-the-request-queue-command
created: 2026-10-25T19:13:22Z
updated: 2026-11-08T04:05:51Z
---

## Description

Source: Unified model, PM catalog (`request-queue`: "Processes external requests (support, internal teams) and connects them to the backlog"; degradation "Unavailable; suggests triage").

## Acceptance criteria

- [x] Lists open requests and turns accepted ones into issues or links them to existing ones
- [x] Without a request queue it suggests triage
