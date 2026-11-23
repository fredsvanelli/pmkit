---
id: PMK-378
title: Check the Jira time tracking flows against a live site
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-80]
milestone: jira
created: 2026-11-23T05:37:43.860Z
updated: 2026-11-23T05:37:48Z
---

## Description

Source: PMK-80 (docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "Facts" and "Risks"; docs/runbooks/time-jira.md). The Jira time tracking code was checked against the fake Jira only. Run the time-jira runbook against a real Jira Cloud site and settle each point the fake assumed.

## Acceptance criteria

- [ ] POST worklog with timeSpentSeconds and started in the yyyy-MM-dd'T'HH:mm:ss.SSSZ format adds the worklog, and GET worklog pages it in worklogs
- [ ] The worklog field on a search carries at most 20 worklogs with the total, so metricEvents reads the rest
- [ ] A worklog writes timespent and WorklogId changelog items (dropped from the events) and nothing else that would count the time twice
- [ ] With time tracking off, the configuration read reports it and capabilities shows time_tracking absent
