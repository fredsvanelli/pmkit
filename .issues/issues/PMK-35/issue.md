---
id: PMK-35
title: "Implement issues, relations and search for Linear"
type: feature
status: in_progress
priority: medium
estimate: 8
assignee: fred
parent: EPC-5
blocked_by: [PMK-33]
milestone: linear
branch: pmk-35-implement-issues-relations-and-search
created: 2026-10-25T19:13:21Z
updated: 2026-10-28T01:55:21Z
---

## Description

Source: Unified model, Adapter operations contract (Issues, Native search, Relations); Common status categories (Linear column).

## Acceptance criteria

- [ ] The adapter implements the Issues and Relations operations of the contract
- [ ] `move_to_category` sets the workflow state mapped to the category
- [ ] Issue filters translate to Linear filters
