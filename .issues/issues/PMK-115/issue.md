---
id: PMK-115
title: Cover sprint aliases in the contract suite
type: task
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-1
related: [PMK-114]
milestone: local-gaps
branch: pmk-115-cover-sprint-aliases-in-the-contract
created: 2026-10-26T17:58:03.096Z
updated: 2026-10-26T23:46:24Z
---

## Description

Found in PMK-114. `scripts/contract-suite.mjs` has no block for the sprint aliases `current` and `none`. Add one that covers `createIssue`, `updateIssue`, `moveToCycle` and `searchIssues`, with and without an active sprint, so any adapter gets the same behavior as the local tracker.

## Acceptance criteria

- [ ] With an active sprint, `createIssue` and `updateIssue` with `sprint: 'current'` store the active sprint id, `moveToCycle` with `current` moves issues into it, and the contract's form of `none` takes an issue out of its sprint
- [ ] With no active sprint, `createIssue`, `updateIssue` and `moveToCycle` with `current` fail with `INVALID_INPUT` and write nothing
- [ ] `searchIssues` with `sprint: 'current'` returns the issues of the active sprint and with `sprint: 'none'` the issues in no sprint, and with no active sprint `sprint: 'current'` returns an empty list
- [ ] The block lives in `scripts/contract-suite.mjs`, runs against the local tracker through `scripts/contract.test.mjs`, and `npm test` passes
