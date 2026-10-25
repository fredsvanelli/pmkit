---
id: PMK-40
title: Exercise the degraded paths of every command against Linear
type: task
status: backlog
priority: medium
estimate: 3
parent: EPC-5
blocked_by: [PMK-39]
milestone: linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: ADR-0001, Consequences ("tests against it alone never exercise a command's degraded path"); MVP skills, rule 4.

## Acceptance criteria

- [ ] Each command that needs a conditional or absent capability takes its degraded path on Linear
- [ ] Each degraded result says which path it used
