---
id: PMK-383
title: Tidy the PMK-82 Jira plans review minors
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-82]
milestone: jira
created: 2026-11-23T16:11:27.010Z
updated: 2026-11-23T16:11:39Z
---

## Description

Source: the PMK-82 reviews (task reviews and the whole-branch review). Minor findings left open on the Jira Plans code.

## Acceptance criteria

- [ ] scripts/cli-plans-jira.test.mjs covers jira plans get on a 403 site (the off text), a 404 (NOT_FOUND) and a 401 (AUTH)
- [ ] scripts/plugin.test.mjs asserts that commands/jira/plans-scenarios.md step 2 stops on available false and shows enableHint
- [ ] jira plans get lists the warnings for several gone teams in team order, not in the order the reads finish
- [ ] The fake Jira Plans list honors includeArchived, includeTrashed and maxResults, so the CLI flags are checked end to end
