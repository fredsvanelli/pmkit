---
id: PMK-152
title: Decide what none and an unknown sprint do in the contract
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-115]
milestone: local-gaps
created: 2026-10-28T00:11:38.322Z
updated: 2026-10-28T00:11:38Z
---

## Description

Found in PMK-115. The contract does not say what the string `none` does as a sprint value in `createIssue`, `updateIssue` and `moveToCycle` (the CLI maps it to `null`). An unknown sprint ID gives `INVALID_INPUT` in create and update and `NOT_FOUND` in `moveToCycle`. Decide one rule for each and write it in the design spec and the contract suite.
