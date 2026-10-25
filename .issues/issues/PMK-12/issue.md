---
id: PMK-12
title: Expose one MCP tool per CLI operation
type: feature
status: backlog
priority: high
estimate: 5
parent: EPC-2
blocked_by: [PMK-11]
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Technical spec, MCP server ("one tool per contract operation (`issues_search`, `issues_create`, `issues_move`, `cycle_current`, `pr_open`…). Tool input schemas are generated from the same validators the CLI uses. Writes return the before → after diff").

## Acceptance criteria

- [ ] One tool per contract operation
- [ ] Tool input schemas come from the validators the CLI uses
- [ ] A write returns the before → after diff
- [ ] A failure returns the error code, message and next step
