---
id: PMK-4NQ5
title: Read history and comments from Linear
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-NCQN
blocked_by: [PMK-1HR3]
milestone: linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Unified model, contract families History ("Basis for derived metrics; normalizes status events") and Comments (`list_comments`, `comment`, `resolve_thread`).

## Acceptance criteria

- [ ] `get_history` returns status changes as events in the common shape
- [ ] The adapter lists, adds and resolves comment threads
