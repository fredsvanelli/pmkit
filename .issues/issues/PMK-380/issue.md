---
id: PMK-380
title: Tidy the PMK-80 Jira time tracking review minors
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-80]
milestone: jira
created: 2026-11-23T05:58:10.091Z
updated: 2026-11-23T05:58:20Z
---

## Description

Source: the PMK-80 review (whole-branch review and utils:review-work). Minor findings left open on the Jira time tracking code.

## Acceptance criteria

- [ ] issues time-entries on Jira lists the entries sorted by their date, so a worklog backdated in Jira comes before later ones
- [ ] worklogsOf warns when the worklog read stops before the last page (hasMore), as metricEvents does
- [ ] scripts/lib/jira/manifest.test.mjs no longer has a test name saying an unserved capability names its issue
- [ ] A site that turns time tracking on, or a stale discovery cache, never leaves the log_time history out for long: getHistory reads the worklogs once time tracking shows on
