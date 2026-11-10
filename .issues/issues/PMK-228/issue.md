---
id: PMK-228
title: Improve record-decision
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
related: [PMK-65]
branch: pmk-228-improve-record-decision
created: 2026-11-08T20:37:25.277Z
updated: 2026-11-10T17:19:53Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-65 (record-decision) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-65.

### Scope (in)

- A `validate` or `/pmkit:local:doctor` check that no two ADRs share a number.
- A `docs` field on issues, so a link to an ADR is not only a comment.
- A command to change the status of an existing ADR (superseded, deprecated).
- Read `origin/HEAD` when `default_branch` is not set.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] A `validate` or `/pmkit:local:doctor` check that no two ADRs share a number
- [ ] A `docs` field on issues, so a link to an ADR is not only a comment
- [ ] A command to change the status of an existing ADR (superseded, deprecated)
- [ ] Read `origin/HEAD` when `default_branch` is not set
