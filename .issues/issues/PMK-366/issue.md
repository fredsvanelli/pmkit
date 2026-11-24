---
id: PMK-366
title: Check Jira discovery and the manifest against a live site
type: chore
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-14
related: [PMK-76]
milestone: jira
branch: fredsvanelli/pmk-366-check-jira
created: 2026-11-22T19:42:30.042Z
updated: 2026-11-24T18:41:24Z
---

## Description

PMK-76 built Jira discovery and the capability manifest from Atlassian's OpenAPI documents and checked them only against the fake Jira site (`scripts/fake-jira-api.mjs`, `jiraSiteRoutes`): no Jira credentials existed. Run `pmkit discover --json` and `pmkit capabilities --json` on a real Jira Cloud site once credentials exist, and fix the fake where the real answers differ. Spec: `docs/superpowers/specs/2026-11-22-pmk-76-jira-discovery-and-manifest-design.md`, "Risks".

## Acceptance criteria

- [ ] `discover` runs on a company-managed space and on a team-managed space; `style`, work type levels and status categories match the site
- [ ] The field-role rules (board estimation field, `jsw-story-points`, `gh-sprint`, `duedate`, `Start date`) find the right field on both styles, or the rules are corrected
- [ ] The license, `configuration` and board reads match the documented shapes, and a token without admin rights still discovers with warnings
