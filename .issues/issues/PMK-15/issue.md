---
id: PMK-15
title: Package the Codex plugin
type: feature
status: backlog
priority: high
estimate: 3
parent: EPC-2
blocked_by: [PMK-12, PMK-14]
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Technical spec, Packaging per agent (Codex row); Unified model, Q2 decision D.

## Acceptance criteria

- [ ] The package holds the generated skills, invoked as `$pmkit-issues-create`
- [ ] The MCP server is declared in `.mcp.json`
- [ ] A Codex plugin marketplace file installs it
