---
id: PMK-339
title: "Read priority, estimate and dates from labels on GitHub repositories without a Project"
type: feature
status: in_progress
priority: low
estimate: 3
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-339-read-priority-estimate-and-dates-from
created: 2026-11-17T21:22:17.656Z
updated: 2026-11-21T20:18:36Z
---

## Description

Found while working PMK-89 (PR #312). Without a Project, statuses and types can come from `label:<name>` mappings (ADR 0009), but the field roles `priority`, `estimate`, `start_date` and `target_date` can only come from org issue fields, which GHES before 3.21 lacks. Decide whether those roles may also map to labels (for example `priority: label:P1` style sets), and implement it if so.

## Acceptance criteria

- [ ] An ADR or design doc records whether field roles may map to labels without a Project
