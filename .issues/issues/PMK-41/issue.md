---
id: PMK-41
title: Add local-migrate between the Local tracker and Linear
type: feature
status: in_review
priority: medium
estimate: 8
assignee: fred
parent: EPC-5
blocked_by: [PMK-36, PMK-37, PMK-38]
milestone: linear
branch: pmk-41-add-local-migrate-between-the-local
created: 2026-10-25T19:13:21Z
updated: 2026-10-29T02:27:02Z
---

## Description

Source: Unified model, System-specific skills (`local-migrate`: "Exports the local tracker to any hosted system through its adapter, or imports from one into .issues/, mapping IDs and keeping links"); MVP skills, MQ4.

## Acceptance criteria

- [x] Exports `.issues/` to Linear and imports from Linear into `.issues/`
- [x] Maps IDs and keeps parents, blockers and links
- [x] Shows the full preview before writing
