---
id: PMK-224
title: Improve team capacity
type: feature
status: done
priority: low
estimate: 3
assignee: fred
related: [PMK-72]
branch: pmk-224-improve-team-capacity
created: 2026-11-08T20:37:24.737Z
updated: 2026-11-10T17:15:35Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-72 (team capacity) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-72.

### Scope (in)

- Recompute the capacity when the days off change. Today the command only says the capacity does not change by itself.
- `--sprint current` in `cycle capacity`, and the team check there on Linear (`writeEntry` takes any workspace user).
- Build the load report once on the write path.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Recompute the capacity when the days off change
- [x] `--sprint current` in `cycle capacity`, and the team check there on Linear (`writeEntry` takes any workspace user)
- [x] Build the load report once on the write path
