---
id: PMK-234
title: Guard the prioritize-by-demand write
type: feature
status: done
priority: medium
estimate: 2
assignee: fred
related: [PMK-68, PMK-241, PMK-242]
branch: pmk-234-guard-the-prioritize-by-demand-write
created: 2026-11-08T20:37:26.100Z
updated: 2026-11-10T03:11:11Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-68 (prioritize-by-demand) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-68. Split into this issue and PMK-241 and PMK-242.

### Scope (in)

- A stale-write guard between the preview and the write, with `issues bulk --expect`.
- A ranking-only mode that proposes nothing.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] A stale-write guard between the preview and the write, with `issues bulk --expect`
- [x] A ranking-only mode that proposes nothing
