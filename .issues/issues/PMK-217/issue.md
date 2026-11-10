---
id: PMK-217
title: Improve review-pr-against-issue
type: feature
status: done
priority: low
estimate: 5
assignee: fred
related: [PMK-61]
branch: pmk-217-improve-review-pr-against-issue
created: 2026-11-08T20:37:23.715Z
updated: 2026-11-10T06:46:44Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-61 (review-pr-against-issue) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-61.

### Scope (in)

- Comment on the pull request itself, with inline findings.
- Read the diff file by file when it is cut.
- Read `ci logs` and `pr status` into the review, so a failing check shows as a gap.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [x] Comment on the pull request itself, with inline findings
- [x] Read the diff file by file when it is cut
- [x] Read `ci logs` and `pr status` into the review, so a failing check shows as a gap
