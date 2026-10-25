---
id: PMK-EEMA
title: Register only the tools whose capability is present
type: feature
status: backlog
priority: high
estimate: 2
parent: EPC-E7GJ
blocked_by: [PMK-0SC2, PMK-YJQN]
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Unified model, Q3 decision D; Technical spec, MCP server ("At startup it reads the capability manifest and skips tools whose capability is absent").

## Acceptance criteria

- [ ] At startup the server reads the capability manifest
- [ ] A tool whose capability is `absent` is not listed
