---
id: PMK-231
title: Cover the Windows exit code of alerts list in tests and docs
type: feature
status: backlog
priority: low
related: [PMK-175]
created: 2026-11-08T20:37:25.687Z
updated: 2026-11-08T20:37:25Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-175 (alerts list on Windows) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-175.

### Scope (in)

- Tests for status 9009 outside `win32` and for a `null` status.
- The CHANGELOG and the plan describe only the text check, not the 9009 exit code.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Tests cover status 9009 outside `win32` and a `null` status
- [ ] The CHANGELOG and the plan describe the 9009 exit code as well as the text check
