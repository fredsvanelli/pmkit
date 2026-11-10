---
id: PMK-211
title: Improve issues time-entries
type: feature
status: in_review
priority: low
estimate: 3
assignee: fred
related: [PMK-51]
branch: pmk-211-improve-issues-time-entries
created: 2026-11-08T20:37:22.800Z
updated: 2026-11-10T03:32:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-51 (issues time-entries) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-51.

### Scope (in)

- Share one "positive integer" rule between `logTime` and `listTimeEntries`.
- Check `ignored` in `scripts/contract-suite.mjs`.
- Totals per person and per sprint.
- Use `time-entries` in `/pmkit:issues:progress`.
- Show the time in readable form (`1h30`) in `time-entries`. (moved from PMK-227)

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Share one "positive integer" rule between `logTime` and `listTimeEntries`
- [x] Check `ignored` in `scripts/contract-suite.mjs`
- [x] Totals per person and per sprint
- [x] Use `time-entries` in `/pmkit:issues:progress`
- [x] Show the time in readable form (`1h30`) in `time-entries`
