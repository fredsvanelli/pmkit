---
id: PMK-368
title: Check the Jira setup against a live site
type: chore
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-14
related: [PMK-365, PMK-394]
milestone: jira
branch: fredsvanelli/pmk-368-check-jira
created: 2026-11-23T01:16:13.890Z
updated: 2026-11-24T20:09:01Z
---

## Description

PMK-365 built `init --tracker jira` and the `/pmkit:setup` Jira sections and checked them only against the fake Jira site (`scripts/fake-jira-api.mjs`): no Jira credentials existed. Run setup on a real Jira Cloud site once credentials exist, and fix the proposal rules or the fake where the real answers differ. Spec: `docs/superpowers/specs/2026-11-22-pmk-365-setup-pmkit-on-jira-design.md`, "Risks".

## Acceptance criteria

- [ ] `init --tracker jira --site <host> --dry-run --json` lists the spaces the token's owner can browse, and a held space the site lacks is asked again
- [ ] The estimate candidates (custom number fields plus `timeoriginalestimate`) and the acceptance-criteria candidates (custom string fields) match what a company-managed and a team-managed space offer, and the recommended estimate is the board's estimation field
- [ ] The recommended statuses and work types match a default Jira Software space (Story, Bug, Task, Epic), and accepting every recommendation writes a config that `validate` and `discover` accept
