---
id: PMK-85
title: Add the GitHub Issues and Projects client
type: feature
status: backlog
priority: low
estimate: 5
parent: EPC-8
blocked_by: [PMK-84, PMK-31]
milestone: github-issues
created: 2026-10-25T19:13:23Z
updated: 2026-10-25T19:13:27Z
---

## Description

Source: Unified model, Q1 decision D; GitHub tab ("Projects v2 depends heavily on GraphQL").

## Acceptance criteria

- [ ] Calls the GitHub GraphQL API, reusing the `gh` login
- [ ] Maps failures to the pmkit error codes
