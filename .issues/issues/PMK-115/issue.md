---
id: PMK-115
title: Cover sprint aliases in the contract suite
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-114]
milestone: local-gaps
created: 2026-10-26T17:58:03.096Z
updated: 2026-10-26T17:58:03Z
---

## Description

Found in PMK-114. `scripts/contract-suite.mjs` has no block for the sprint aliases `current` and `none`. Add one that covers `createIssue`, `updateIssue`, `moveToCycle` and `searchIssues`, with and without an active sprint, so any adapter gets the same behavior as the local tracker.
