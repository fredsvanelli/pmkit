---
id: PMK-152
title: Decide what none and an unknown sprint do in the contract
type: task
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-115]
milestone: local-gaps
branch: pmk-152-decide-what-none-and-an-unknown-sprint
created: 2026-10-28T00:11:38.322Z
updated: 2026-11-22T03:52:36Z
---

## Description

Found in PMK-115. The contract does not say what the string `none` does as a sprint value in `createIssue`, `updateIssue` and `moveToCycle` (the CLI maps it to `null`). An unknown sprint ID gives `INVALID_INPUT` in create and update and `NOT_FOUND` in `moveToCycle`. Decide one rule for each and write it in the design spec and the contract suite.

## Acceptance criteria

- [x] The design spec states what `none` and an unknown sprint ID do in `createIssue`, `updateIssue` and `moveToCycle`
- [x] Local, Linear and GitHub follow it: an unknown sprint ID, and `none`, fail with `INVALID_INPUT` and write nothing
- [x] The contract suite covers both cases for the three operations
