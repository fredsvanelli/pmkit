---
id: PMK-381
title: Check the Jira plans flows against a live site
type: chore
status: in_review
priority: low
assignee: fred
parent: EPC-14
related: [PMK-82, PMK-399]
milestone: jira
branch: fredsvanelli/pmk-381-check-jira
created: 2026-11-23T16:11:26.811Z
updated: 2026-11-25T05:09:29Z
---

## Description

Source: PMK-82 (docs/superpowers/specs/2026-11-23-pmk-82-jira-plans-scenarios-design.md, "Facts"; docs/runbooks/plans-jira.md). The Jira Plans reader was checked against the fake Jira only. Run the plans-jira runbook against a real Jira Cloud Premium site, and a Standard one, and settle each point the fake assumed.

## Acceptance criteria

- [ ] GET /rest/api/3/plans/plan, /plan/{id}, /plan/{id}/team and the planonly and atlassian team reads answer the shapes the design lists
- [ ] The plan list and the team list page with cursor, nextPageCursor and last, as client.paginate reads them
- [ ] A Standard site and a Premium site whose token owner lacks Administer Jira both answer 403, and jira plans list shows available false with the hint
- [ ] The capacity unit pmkit shows (story points per sprint for Scrum, per week for Kanban) matches what Jira Plans shows
