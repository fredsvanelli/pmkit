---
id: PMK-87
title: "Implement issues, sub-issues and dependencies for GitHub Issues"
type: feature
status: in_review
priority: low
estimate: 8
assignee: fred
parent: EPC-8
blocked_by: [PMK-86]
milestone: github-issues
branch: pmk-87-implement-issues-sub-issues-and
created: 2026-10-25T19:13:23Z
updated: 2026-11-16T23:29:40Z
---

## Description

Source: Unified model, Common status categories ("project field plus open or closed (GitHub)").

## Acceptance criteria

- [x] The adapter implements the Issues, Relations, History, Comments and Native search operations
- [x] `move_to_category` sets the Status option and opens or closes the issue
