---
id: PMK-227
title: Improve log-time
type: feature
status: in_progress
priority: low
estimate: 1
assignee: fred
related: [PMK-60]
branch: pmk-227-improve-log-time
created: 2026-11-08T20:37:25.141Z
updated: 2026-11-10T17:26:59Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-60 (log-time) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-60.

### Scope (in)

- A scenario against a Linear fixture for the comment path.
- Make `progress` step 8 follow `log-time` directly, if scenario rule 5 (explicit CLI calls per step) is relaxed.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] A scenario against a Linear fixture for the comment path
- [ ] Make `progress` step 8 follow `log-time` directly, if scenario rule 5 (explicit CLI calls per step) is relaxed
