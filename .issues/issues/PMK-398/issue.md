---
id: PMK-398
title: "Check the Jira release filter's quoted version id on a live site"
type: chore
status: canceled
priority: low
parent: EPC-14
related: [PMK-370]
duplicate_of: [PMK-373]
milestone: jira
created: 2026-11-25T01:10:27.255Z
updated: 2026-11-25T01:53:53Z
---

## Description

Follow-up of PMK-370. Jira reads a quoted sprint value in JQL as a sprint name, so `sprint = "9"` found nothing on a live site; PMK-370 now sends the id unquoted. The release filter sends `fixVersion = "<version id>"` quoted the same way (`scripts/lib/jira/filter.mjs`), and Jira may read it as a version name too. Not checkable on the PMK-370 site: its Releases feature is off.

## Acceptance criteria

- [ ] On a live site with versions, issues list --release <name> finds the work items of that version
- [ ] If a quoted id matches nothing, the filter sends the version id unquoted and the fake reads a quoted value as a name
