---
id: PMK-401
title: "events --since reads the date in UTC, not the user's zone"
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-378]
milestone: jira
created: 2026-11-25T04:23:17.103Z
updated: 2026-11-25T04:23:17Z
---

## Description

Source: PMK-378. events --since <date> reads the date as a UTC day, so a user west of UTC who passes today's local date late in the evening misses or gains events at the day's edges. Read the date in the user's zone, or say in the help and the output that it is UTC.

## Acceptance criteria

- [ ] events --since <date> either reads the date in the user's local zone or states that it is UTC in the help text and the output
- [ ] A test pins the chosen behaviour with a fixed clock and a non-UTC zone
