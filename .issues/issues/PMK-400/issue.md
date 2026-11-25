---
id: PMK-400
title: "The fake Jira's remaining estimate assumes no estimate is set"
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-378]
milestone: jira
created: 2026-11-25T04:23:14.863Z
updated: 2026-11-25T04:23:15Z
---

## Description

Source: PMK-378 (docs/superpowers/specs/2026-11-25-pmk-378-check-jira-time-tracking-live-design.md). The fake Jira (scripts/fake-jira-issues.mjs) writes a timeestimate changelog item with each worklog as the site does on a work item with no estimate (null to 0, then 0 to 0). With an original or remaining estimate set, Jira's auto-adjust lowers the remaining estimate by the time logged; the fake does not model that.

## Acceptance criteria

- [ ] The fake's worklog POST writes the timeestimate item from the work item's remaining estimate, lowered by the time logged and not below 0
- [ ] A runbook or unit test covers a worklog on a work item with an estimate set
