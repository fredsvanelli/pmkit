---
id: PMK-213
title: Improve goals
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
related: [PMK-45]
branch: pmk-213-improve-goals
created: 2026-11-08T20:37:23.113Z
updated: 2026-11-10T04:03:27Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-45 (goals) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-45.

### Scope (in)

- A `goal_prefix` config key.
- Commands to update, close and delete a goal.
- A goal status or owner.
- Serve Linear initiatives.
- Warn in `goal progress` when a linked epic file does not parse.
- `validate` counts goals in `checked`.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] A `goal_prefix` config key
- [x] Commands to update, close and delete a goal
- [x] A goal status or owner
- [x] Serve Linear initiatives
- [x] Warn in `goal progress` when a linked epic file does not parse
- [x] `validate` counts goals in `checked`
