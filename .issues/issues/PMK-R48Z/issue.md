---
id: PMK-R48Z
title: Package plain skill folders for OpenCode and other agents
type: feature
status: backlog
priority: high
estimate: 3
parent: EPC-E7GJ
blocked_by: [PMK-7W0R]
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Technical spec, Packaging per agent (OpenCode row: "Generated skills `/pmkit-issues-create`", "MCP snippet printed by setup", "`npx skills add fredsvanelli/skills`"). The repository moved out of `fredsvanelli/skills`, so the install source needs a decision.

## Acceptance criteria

- [ ] The skill folders install with `npx skills add`
- [ ] Setup prints the MCP snippet for the agent
