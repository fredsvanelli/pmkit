---
id: PMK-53
title: Add the link-repo command
type: feature
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
blocked_by: [PMK-31]
milestone: generic-commands
branch: pmk-53-add-the-link-repo-command
created: 2026-10-25T19:13:21Z
updated: 2026-10-31T15:52:05Z
---

## Description

Source: Unified model, Foundation catalog (`link-repo`: "Links the repository to a system, scope and default git host"; degradation "Inferred from the git remote when possible"); Linear tab ("This repo belongs to team ENG").

## Acceptance criteria

- [ ] Writes the tracker scope and git host to `.pmkit/config.yaml` after confirmation
- [ ] Infers the git host from the git remote
