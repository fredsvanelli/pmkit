---
id: PMK-16
title: Package plain skill folders for OpenCode and other agents
type: feature
status: backlog
priority: high
estimate: 3
parent: EPC-2
blocked_by: [PMK-14]
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Technical spec, Packaging per agent (OpenCode row: "Generated skills `/pmkit-issues-create`", "MCP snippet printed by setup", "`npx skills add fredsvanelli/skills`"). The repository moved out of `fredsvanelli/skills`, so the install source needs a decision.

## Acceptance criteria

- [ ] The skill folders install with `npx skills add`
- [ ] Setup prints the MCP snippet for the agent
