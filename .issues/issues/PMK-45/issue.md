---
id: PMK-45
title: Add strategic goals to the Local tracker
type: feature
status: in_progress
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
blocked_by: [PMK-2]
milestone: generic-commands
branch: pmk-45-add-strategic-goals-to-the-local-tracker
created: 2026-10-25T19:13:21Z
updated: 2026-10-30T23:12:40Z
---

## Description

Source: Local adapter, Entity mapping ("`goals/<ID>.md`, linked to epics") and Capabilities ("progress rolled up from epics"); Technical spec, `EpicFrontmatter.goal`; Unified model, `list_goals`, `goal_progress`.

## Acceptance criteria

- [ ] `goals/<ID>.md` holds a goal that epics link to
- [ ] The CLI lists goals and computes their progress from their epics
- [ ] `capabilities` reports `strategic_goals` as native
