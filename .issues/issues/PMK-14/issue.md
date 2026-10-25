---
id: PMK-14
title: Generate skill folders for Codex and OpenCode
type: feature
status: backlog
priority: high
estimate: 5
parent: EPC-2
milestone: faces
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

Commands reference `${CLAUDE_PLUGIN_ROOT}`, which the other agents do not set.

Source: ADR-0002 (`scripts/package.mjs`); MVP skills, MQ1 decision C; Technical spec, Packaging per agent.

## Acceptance criteria

- [ ] `scripts/package.mjs` writes one skill folder per command, named `pmkit-<group>-<action>`
- [ ] Each `SKILL.md` carries the command's description and procedure
- [ ] A second run on unchanged commands produces the same files
