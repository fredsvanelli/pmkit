---
id: PMK-53
title: Add the link-repo command
type: feature
status: backlog
priority: low
estimate: 2
parent: EPC-6
blocked_by: [PMK-31]
milestone: generic-commands
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:26Z
---

## Description

Source: Unified model, Foundation catalog (`link-repo`: "Links the repository to a system, scope and default git host"; degradation "Inferred from the git remote when possible"); Linear tab ("This repo belongs to team ENG").

## Acceptance criteria

- [ ] Writes the tracker scope and git host to `.pmkit/config.yaml` after confirmation
- [ ] Infers the git host from the git remote
