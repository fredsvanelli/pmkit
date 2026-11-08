---
id: PMK-230
title: Improve security-alerts
type: feature
status: backlog
priority: low
estimate: 5
related: [PMK-73]
created: 2026-11-08T20:37:25.552Z
updated: 2026-11-08T20:53:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-73 (security-alerts) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-73.

### Scope (in)

- Fold transitive advisories into the root package's issue, once `alerts list` carries the `via` graph.
- Comment on or close an issue whose alert is gone from the audit.
- Show the current priority of a matched issue and flag a severity that went up.
- A scenario with a fake npm. (Scanners besides `npm audit` are in PMK-208.)

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Fold transitive advisories into the root package's issue, once `alerts list` carries the `via` graph
- [ ] Comment on or close an issue whose alert is gone from the audit
- [ ] Show the current priority of a matched issue and flag a severity that went up
- [ ] A scenario with a fake npm
