---
id: PMK-153
title: Cover the remaining sprint and assignee aliases in the contract suite
type: task
status: done
priority: low
assignee: fred
parent: EPC-1
related: [PMK-115]
milestone: local-gaps
branch: pmk-153-cover-the-remaining-sprint-and-assignee
created: 2026-10-28T00:11:38.487Z
updated: 2026-11-22T05:53:07Z
---

## Description

Found in PMK-115. The design spec's Cycles row does not say that `moveToCycle` takes `null` for no sprint. `scripts/contract-suite.mjs` does not cover `current` with `dryRun`, the assignee aliases `me` and `none`, or the search filter with an unknown sprint ID.

## Acceptance criteria

- [x] The design spec Cycles row says `moveToCycle` takes `current` and `null` (no sprint), and the `searchIssues` paragraph says an unknown sprint ID fails with `INVALID_INPUT`
- [x] The contract suite covers `current` with `dryRun` on `createIssue`, `updateIssue` and `moveToCycle`
- [x] The contract suite covers the assignee aliases `me` and `none` in `searchIssues`
- [x] The contract suite covers `searchIssues` with an unknown sprint ID, and Local, Linear and GitHub all refuse it with `INVALID_INPUT`
