---
id: PMK-76
title: Discover a Jira site and build its capability manifest
type: feature
status: in_review
priority: low
estimate: 8
assignee: fred
parent: EPC-7
blocked_by: [PMK-75]
related: [PMK-366]
milestone: jira
branch: pmk-76-discover-a-jira-site-and-build-its
created: 2026-10-25T19:13:22Z
updated: 2026-11-22T19:43:21Z
---

## Description

Source: Jira tab, Fields and metadata, Workflows and statuses; Unified model, Field roles ("the estimate role points to `customfield_10016`") and Capabilities (Jira column).

## Acceptance criteria

- [ ] `discover` returns spaces, work types, statuses with categories and the field for each role
- [ ] Handles company-managed and team-managed spaces
- [ ] `capabilities` reports the paths the plan allows
