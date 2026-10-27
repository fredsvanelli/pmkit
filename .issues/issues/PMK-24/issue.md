---
id: PMK-24
title: Add the triage command
type: feature
status: in_review
priority: medium
estimate: 3
assignee: fred
parent: EPC-3
milestone: phase-2-commands
branch: pmk-24-add-the-triage-command
created: 2026-10-25T19:13:20Z
updated: 2026-10-27T02:13:09Z
---

## Description

Source: Unified model, EM catalog (`triage`: "Processes untriaged issues with suggestions"); Linear tab, Assisted triage ("suggests team, priority, labels, duplicate or decline"; "Applies accepted decisions, in bulk or one by one"); Local adapter (`native_triage`: statuses in the triage category).

## Acceptance criteria

- [x] Lists the issues in the triage category with a suggested priority, labels, duplicate or decline for each
- [x] Applies the accepted decisions in bulk or one by one, after a preview
