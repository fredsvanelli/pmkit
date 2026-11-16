---
id: PMK-85
title: Add the GitHub Issues and Projects client
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
parent: EPC-8
blocked_by: [PMK-84, PMK-31]
milestone: github-issues
branch: pmk-85-add-the-github-issues-and-projects
created: 2026-10-25T19:13:23Z
updated: 2026-11-16T18:13:30Z
---

## Description

Source: Unified model, Q1 decision D; GitHub tab ("Projects v2 depends heavily on GraphQL").

## Acceptance criteria

- [ ] Calls the GitHub GraphQL API, reusing the `gh` login
- [ ] Maps failures to the pmkit error codes
