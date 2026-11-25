---
id: PMK-373
title: "Check the Jira epic, release and status-update flows against a live site"
type: chore
status: in_progress
priority: low
assignee: fred
parent: EPC-14
milestone: jira
branch: fredsvanelli/pmk-373-check-jira
created: 2026-11-23T04:51:57.971Z
updated: 2026-11-25T01:47:18Z
---

## Description

Source: PMK-79 (docs/superpowers/specs/2026-11-23-pmk-79-map-jira-epics-versions-status-updates-design.md, "Facts" and "Risks"; docs/runbooks/epics-releases-jira.md). The Jira epic, version and status-update code was checked against the fake Jira only. Run the epics-releases-jira runbook against a real Jira Cloud site and settle each point the fake assumed.

## Acceptance criteria

- [ ] epic create, list, get, progress, move and update work on a real space with an Epic work type (company-managed and team-managed)
- [ ] A comment created with properties keeps them, and GET comment?expand=properties returns them, so epic updates lists the status updates
- [ ] Version paging, POST version, PUT version released and fixVersions [{ id }] behave as the design assumes
- [ ] fixVersion = "<id>" matches by id, not by a version named like the id (else send the id unquoted)
- [ ] Creating a release whose name an archived version holds, or that differs only in case, is mapped to CONFLICT or recorded
- [ ] Setting a release on an issue keeps or drops its archived fix versions as recorded
