---
id: PMK-36
title: Read history and comments from Linear
type: feature
status: in_progress
priority: medium
estimate: 5
assignee: fred
parent: EPC-5
blocked_by: [PMK-35]
milestone: linear
branch: pmk-36-read-history-and-comments-from-linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-28T17:25:37Z
---

## Description

Source: Unified model, contract families History ("Basis for derived metrics; normalizes status events") and Comments (`list_comments`, `comment`, `resolve_thread`).

## Acceptance criteria

- [ ] `get_history` returns status changes as events in the common shape
- [ ] The adapter lists, adds and resolves comment threads
