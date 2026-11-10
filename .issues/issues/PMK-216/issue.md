---
id: PMK-216
title: Improve estimate-issue
type: feature
status: in_progress
priority: low
estimate: 3
assignee: fred
related: [PMK-59]
branch: pmk-216-improve-estimate-issue
created: 2026-11-08T20:37:23.568Z
updated: 2026-11-10T05:48:29Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-59 (estimate-issue) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-59.

### Scope (in)

- A scenario with a tracker that has no estimate field, to cover the comment path.
- Find similar issues with a text-similarity read in the CLI instead of `--text` keywords. PMK-237 reuses it.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] A scenario with a tracker that has no estimate field, to cover the comment path
- [x] Find similar issues with a text-similarity read in the CLI instead of `--text` keywords
