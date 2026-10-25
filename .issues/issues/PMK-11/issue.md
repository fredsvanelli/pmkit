---
id: PMK-11
title: Add the stdio MCP server
type: feature
status: backlog
priority: high
estimate: 3
parent: EPC-2
milestone: faces
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T19:13:19Z
---

## Description

Source: Technical spec, MCP server ("a hand-written stdio JSON-RPC server (initialize, tools/list, tools/call)") and CLI table (`pmkit mcp`); ADR-0003 (no MCP SDK).

## Acceptance criteria

- [ ] `scripts/mcp-server.mjs` answers `initialize`, `tools/list` and `tools/call` over stdio
- [ ] `pmkit mcp` starts the server
- [ ] `package.json` gains no dependency
