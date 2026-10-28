---
id: PMK-153
title: Cover the remaining sprint and assignee aliases in the contract suite
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-115]
milestone: local-gaps
created: 2026-10-28T00:11:38.487Z
updated: 2026-10-28T00:11:38Z
---

## Description

Found in PMK-115. The design spec's Cycles row does not say that `moveToCycle` takes `null` for no sprint. `scripts/contract-suite.mjs` does not cover `current` with `dryRun`, the assignee aliases `me` and `none`, or the search filter with an unknown sprint ID.
