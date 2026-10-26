---
id: PMK-3
title: Add milestones to the Local tracker
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-1
blocked_by: [PMK-2]
related: [PMK-111]
milestone: local-gaps
branch: pmk-3-add-milestones-to-the-local-tracker
created: 2026-10-25T19:13:19Z
updated: 2026-10-26T15:38:52Z
---

## Description

Today `--milestone` takes any string, and `validate` checks the reference only when `milestones/` exists, which nothing creates. `/pmkit:spec:import` proposes milestones but cannot create them.

Source: Local adapter, Entity mapping ("`milestones/<name>.md` and the issue's `milestone` field"); Technical spec, Core types (`Milestone { id, name, dueDate? }`).

## Acceptance criteria

- [ ] `milestones/<name>.md` holds a name and an optional due date
- [ ] The CLI lists, gets and creates milestones
- [ ] `/pmkit:spec:import` creates the milestones of its tree
