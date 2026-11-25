---
id: PMK-370
title: Check the Jira sprint flows against a live site
type: chore
status: in_progress
priority: low
assignee: fred
parent: EPC-14
related: [PMK-397, PMK-398]
milestone: jira
branch: fredsvanelli/pmk-370-check-jira
created: 2026-11-23T02:44:34.393Z
updated: 2026-11-25T01:10:27Z
---

## Description

Source: PMK-78 (docs/superpowers/specs/2026-11-22-pmk-78-jira-sprints-design.md, "Facts" and "Risks"; docs/runbooks/cycles-jira.md). The Jira sprint code was checked against the fake Jira only. Run the cycles-jira runbook against a real Jira Cloud site with a Scrum board and settle each point the fake assumed.

## Acceptance criteria

- [ ] cycle open creates and starts a sprint on a real Scrum board; cycle close completes it
- [ ] What Jira does with unfinished work items after a REST close (left in the closed sprint or moved to the backlog) is recorded, and ADR 0016 still holds
- [ ] Sprint dates written at 12:00 UTC show the intended calendar day in the Jira UI
- [ ] Sprints of other boards in the board list and the Sprint field are handled as the design says
- [ ] The Agile move endpoints accept a work item the board filter hides, or the refusal is mapped
- [ ] The Sprint changelog item's from/to hold sprint ids as the history mapping assumes
