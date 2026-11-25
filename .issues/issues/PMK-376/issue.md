---
id: PMK-376
title: Split the Jira epic create checks (epicInput)
type: chore
status: backlog
priority: low
parent: EPC-14
related: [PMK-79]
milestone: jira
created: 2026-11-23T05:13:16.061Z
updated: 2026-11-23T05:13:22Z
---

## Description

Source: PMK-79 review (PR #385). epicInput in scripts/lib/jira/epic-ops.mjs holds about 14 decision points (keys, milestone, goal, title, dates, start field, description).

## Acceptance criteria

- [ ] The date and description checks of epicInput live in helpers, as GitHub's epicDates and epicDescription do, with no behavior change and the epic-ops tests unchanged
