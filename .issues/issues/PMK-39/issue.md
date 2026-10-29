---
id: PMK-39
title: Run the contract suite against a Linear sandbox
type: task
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-5
blocked_by: [PMK-36, PMK-37, PMK-38]
milestone: linear
branch: pmk-39-run-the-contract-suite-against-a-linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-29T00:34:29Z
---

## Description

Source: ADR-0001 ("a hosted adapter such as Linear later has to pass the same suite"); Technical spec, Testing item 2 ("future adapters run it against sandboxes").

Open: where the sandbox workspace and its credential live.

## Acceptance criteria

- [x] The contract suite passes against a Linear sandbox workspace
- [x] `npm test` still runs the Local suite with no network
