---
id: PMK-221
title: Improve customers and requests
type: feature
status: in_progress
priority: low
estimate: 5
assignee: fred
related: [PMK-46]
branch: pmk-221-improve-customers-and-requests
created: 2026-11-08T20:37:24.334Z
updated: 2026-11-10T06:55:51Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-46 (customers and requests) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-46.

### Scope (in)

- `customers update` (tier, revenue, owner) and editing the text of a request.
- `requests accept --create`, which creates the issue and links the request in one call.
- The generic customer and request operations on Linear, built on top of `linear customers`.
- Local prints `customers show X` and Linear `show --customer X`; give PMK-68 and PMK-70 one shape on both trackers.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] `customers update` (tier, revenue, owner) and editing the text of a request
- [ ] `requests accept --create`, which creates the issue and links the request in one call
- [ ] The generic customer and request operations on Linear, built on top of `linear customers`
- [ ] Local prints `customers show X` and Linear `show --customer X`; give PMK-68 and PMK-70 one shape on both trackers
