---
id: PMK-8FSH
title: Discover a Jira site and build its capability manifest
type: feature
status: backlog
priority: low
estimate: 8
parent: EPC-QRE9
blocked_by: [PMK-EA23]
milestone: jira
created: 2026-10-25T19:13:22Z
updated: 2026-10-25T19:13:26Z
---

## Description

Source: Jira tab, Fields and metadata, Workflows and statuses; Unified model, Field roles ("the estimate role points to `customfield_10016`") and Capabilities (Jira column).

## Acceptance criteria

- [ ] `discover` returns spaces, work types, statuses with categories and the field for each role
- [ ] Handles company-managed and team-managed spaces
- [ ] `capabilities` reports the paths the plan allows
