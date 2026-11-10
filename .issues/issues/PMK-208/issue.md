---
id: PMK-208
title: Improve alerts list
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
related: [PMK-48]
branch: pmk-208-improve-alerts-list
created: 2026-11-08T20:37:22.344Z
updated: 2026-11-10T02:41:29Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-48 (alerts list) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-48.

### Scope (in)

- Read other scanners: `pip-audit`, `cargo audit`, `yarn audit` and `pnpm audit`.
- Read a saved scanner report, so the command works offline.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Read other scanners: `pip-audit`, `cargo audit`, `yarn audit` and `pnpm audit`
- [x] Read a saved scanner report, so the command works offline
