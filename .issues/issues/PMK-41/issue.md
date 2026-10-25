---
id: PMK-41
title: Add local-migrate between the Local tracker and Linear
type: feature
status: backlog
priority: medium
estimate: 8
parent: EPC-5
blocked_by: [PMK-36, PMK-37, PMK-38]
milestone: linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Unified model, System-specific skills (`local-migrate`: "Exports the local tracker to any hosted system through its adapter, or imports from one into .issues/, mapping IDs and keeping links"); MVP skills, MQ4.

## Acceptance criteria

- [ ] Exports `.issues/` to Linear and imports from Linear into `.issues/`
- [ ] Maps IDs and keeps parents, blockers and links
- [ ] Shows the full preview before writing
