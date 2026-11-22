---
id: PMK-77
title: "Implement work items, transitions, links and JQL for Jira"
type: feature
status: in_progress
priority: low
estimate: 8
assignee: fred
parent: EPC-7
blocked_by: [PMK-76]
milestone: jira
branch: pmk-77-implement-work-items-transitions-links
created: 2026-10-25T19:13:22Z
updated: 2026-11-22T19:50:15Z
---

## Description

Source: Unified model, Common status categories ("transition with required fields (Jira)"); Jira tab, Write policy ("confirmation for transitions that require screen fields").

## Acceptance criteria

- [ ] The adapter implements the Issues, Relations, History, Comments and Native search operations
- [ ] A transition that requires screen fields asks before writing
- [ ] Issue filters translate to JQL
