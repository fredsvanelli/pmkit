---
id: PMK-238
title: Tie TODOs to their owner and issue in todos-to-issues
type: feature
status: backlog
priority: low
estimate: 3
related: [PMK-64, PMK-219]
created: 2026-11-08T20:58:08.631Z
updated: 2026-11-08T20:58:08Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-64 (todos-to-issues) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-64. Split from PMK-219.

### Scope (in)

- Show the owner of a TODO through `git blame`.
- Offer to reference the new issue in the code comment.
- Keep the `todo-key` in an issue field instead of the body.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Show the owner of a TODO through `git blame`
- [ ] Offer to reference the new issue in the code comment
- [ ] Keep the `todo-key` in an issue field instead of the body
