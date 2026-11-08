---
id: PMK-233
title: Improve initiatives-and-goals
type: feature
status: backlog
priority: low
related: [PMK-67]
created: 2026-11-08T20:37:25.965Z
updated: 2026-11-08T20:37:26Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-67 (initiatives-and-goals) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-67.

### Scope (in)

- Read Linear initiatives, so the Linear path does not only use top-level issues.
- Show the goal's target date in the text.
- Build the child map in one pass instead of O(n²), and read the issues once instead of once per goal.
- Reuse `progressOf`, `walkParents`, `problemWarnings` and `capWarning` instead of copies.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Read Linear initiatives, so the Linear path does not only use top-level issues
- [ ] Show the goal's target date in the text
- [ ] Build the child map in one pass instead of O(n²), and read the issues once instead of once per goal
- [ ] Reuse `progressOf`, `walkParents`, `problemWarnings` and `capWarning` instead of copies
