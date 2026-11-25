---
id: PMK-378
title: Check the Jira time tracking flows against a live site
type: chore
status: in_progress
priority: low
assignee: fred
parent: EPC-14
related: [PMK-80]
milestone: jira
branch: fredsvanelli/pmk-378-check-jira
created: 2026-11-23T05:37:43.860Z
updated: 2026-11-25T03:35:19Z
---

## Description

Source: PMK-80 (docs/superpowers/specs/2026-11-23-pmk-80-map-jira-time-tracking-design.md, "Facts" and "Risks"; docs/runbooks/time-jira.md). The Jira time tracking code was checked against the fake Jira only. Run the time-jira runbook against a real Jira Cloud site and settle each point the fake assumed.

## Acceptance criteria

- [x] POST worklog with timeSpentSeconds and started in the yyyy-MM-dd'T'HH:mm:ss.SSSZ format adds the worklog, and GET worklog pages it in worklogs
- [x] The worklog field on a search carries at most 20 worklogs with the total, so metricEvents reads the rest
- [x] A worklog writes timespent and WorklogId changelog items (dropped from the events) and nothing else that would count the time twice
- [ ] With time tracking off, the configuration read reports it and capabilities shows time_tracking absent
- [x] Editing or deleting a worklog in Jira writes no changelog item (such as WorklogTimeSpent) that issues get --history shows as a jira: update; if it does, drop it as timespent is dropped
- [ ] With time tracking off, issues get --history works and the worklog calls are refused as the fake assumes
