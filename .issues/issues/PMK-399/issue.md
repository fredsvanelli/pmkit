---
id: PMK-399
title: Check the Jira plans flows on a Premium site
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-381]
milestone: jira
created: 2026-11-25T04:23:12.801Z
updated: 2026-11-25T04:23:13Z
---

## Description

Source: PMK-381 (docs/superpowers/specs/2026-11-25-pmk-381-check-jira-plans-live-design.md). The owner's site is on Jira Free, so only the non-Premium path of the Jira Plans reader was checked live. Run the plans-jira runbook against a Jira Cloud Premium (or Enterprise) site and settle what the fake assumed; extend the PMK-381 live test in scripts/lib/jira/client-live.mjs, which skips on a Premium site today.

## Acceptance criteria

- [ ] GET /rest/api/3/plans/plan, /plan/{id}, /plan/{id}/team and the planonly and atlassian team reads answer the shapes the PMK-82 design lists
- [ ] The plan list and the team list page with cursor, nextPageCursor and last, as client.paginate reads them
- [ ] A Premium site whose token owner lacks Administer Jira answers 403, and jira plans list shows available false with the hint
- [ ] The capacity unit pmkit shows (story points per sprint for Scrum, per week for Kanban) matches what Jira Plans shows
