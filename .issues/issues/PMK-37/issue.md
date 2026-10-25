---
id: PMK-37
title: Map Linear cycles to sprints
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-5
blocked_by: [PMK-35]
milestone: linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Unified model, contract family Cycles ("Open and close only where the system has that ritual"); Linear tab, Cycles; Capabilities (`capacity`: Derived).

## Acceptance criteria

- [ ] The adapter lists cycles, finds the current one, lists its issues and moves issues between cycles
- [ ] Opening or closing a cycle returns `NOT_SUPPORTED` with the reason
- [ ] Capacity is kept in local context
