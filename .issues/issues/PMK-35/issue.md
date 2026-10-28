---
id: PMK-35
title: "Implement issues, relations and search for Linear"
type: feature
status: done
priority: medium
estimate: 8
assignee: fred
parent: EPC-5
blocked_by: [PMK-33]
milestone: linear
branch: pmk-35-implement-issues-relations-and-search
created: 2026-10-25T19:13:21Z
updated: 2026-10-28T17:25:21Z
---

## Description

Source: Unified model, Adapter operations contract (Issues, Native search, Relations); Common status categories (Linear column).

## Acceptance criteria

- [x] The adapter implements the Issues and Relations operations of the contract
- [x] `move_to_category` sets the workflow state mapped to the category
- [x] Issue filters translate to Linear filters
