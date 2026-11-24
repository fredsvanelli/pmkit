---
id: PMK-364
title: Check the Jira client against a live site
type: chore
status: in_progress
priority: low
assignee: fred
parent: EPC-14
related: [PMK-75]
branch: fredsvanelli/pmk-364-check-jira
created: 2026-11-22T18:49:38.845Z
updated: 2026-11-24T17:41:12Z
---

## Description

Follow-up from PMK-75 (Jira API client). No Jira credentials existed, so ADR 0013 checks against a live site were skipped.

Check `scripts/lib/jira/client.mjs` against a real Jira Cloud site:

- A classic API token authenticates against the site host (`/rest/api/3/myself`).
- A scoped API token authenticates against the site host; if it fails, write the ADR that decides the `api.atlassian.com/ex/jira/<cloudId>` path (ADR 0013).
- `GET /rest/api/3/serverInfo` answers without credentials and returns `deploymentType: Cloud`.
- The 401 and 429 answers match the error mapping.

## Acceptance criteria

- [ ] A classic token passes the session check on a live site
- [ ] A scoped token is checked on the site host, and an ADR is written if it fails
- [ ] Anonymous serverInfo returns Cloud on a live site
