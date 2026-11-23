---
id: PMK-379
title: Warn about logged time in the Jira delete preview
type: feature
status: backlog
priority: low
parent: EPC-14
related: [PMK-80]
milestone: jira
created: 2026-11-23T05:57:44.330Z
updated: 2026-11-23T05:57:56Z
---

## Description

Source: PMK-80 (docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "Non-goals"). On the Local tracker, the delete preview warns "N minutes logged on it are deleted with it". The Jira delete preview does not read the work item's worklogs, so deleting a Jira work item with logged time gives no such warning.

## Acceptance criteria

- [ ] pmkit issues delete <key> --dry-run on Jira warns with the minutes logged on the work item when it has worklogs and time tracking is on
