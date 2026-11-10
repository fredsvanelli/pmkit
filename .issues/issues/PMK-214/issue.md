---
id: PMK-214
title: Improve delegate
type: feature
status: in_review
priority: medium
estimate: 5
assignee: fred
related: [PMK-57]
branch: pmk-214-improve-delegate
created: 2026-11-08T20:37:23.258Z
updated: 2026-11-10T00:20:06Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-57 (delegate) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-57.

### Scope (in)

- Native delegation on Linear, through its `delegate` field for installed app agents.
- An agent member in the `team` fixture, so the goldens show a real delegation.
- Make `delegate` atomic. Today the assignment is written before the comment.
- Teach `/pmkit:issues:work` about delegated issues, so the agent run skips the "assigned to someone else" question.
- `scripts/contract-suite.mjs:135` requires `run === 'local'`, so an adapter with native delegation fails it.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Native delegation on Linear, through its `delegate` field for installed app agents
- [x] An agent member in the `team` fixture, so the goldens show a real delegation
- [x] Make `delegate` atomic
- [x] Teach `/pmkit:issues:work` about delegated issues, so the agent run skips the "assigned to someone else" question
- [x] `scripts/contract-suite.mjs:135` requires `run === 'local'`, so an adapter with native delegation fails it
