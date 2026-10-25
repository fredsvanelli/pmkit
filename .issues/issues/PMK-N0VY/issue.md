---
id: PMK-N0VY
title: Run the contract suite against a Linear sandbox
type: task
status: backlog
priority: medium
estimate: 3
parent: EPC-NCQN
blocked_by: [PMK-4NQ5, PMK-Q9JK, PMK-VP9T]
milestone: linear
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: ADR-0001 ("a hosted adapter such as Linear later has to pass the same suite"); Technical spec, Testing item 2 ("future adapters run it against sandboxes").

Open: where the sandbox workspace and its credential live.

## Acceptance criteria

- [ ] The contract suite passes against a Linear sandbox workspace
- [ ] `npm test` still runs the Local suite with no network
