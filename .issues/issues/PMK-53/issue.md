---
id: PMK-53
title: Add the link-repo command
type: feature
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-6
blocked_by: [PMK-31]
related: [PMK-188]
milestone: generic-commands
branch: pmk-53-add-the-link-repo-command
created: 2026-10-25T19:13:21Z
updated: 2026-10-31T16:59:11Z
---

## Description

Source: Unified model, Foundation catalog (`link-repo`: "Links the repository to a system, scope and default git host"; degradation "Inferred from the git remote when possible"); Linear tab ("This repo belongs to team ENG").

## Acceptance criteria

- [x] Writes the tracker scope and git host to `.pmkit/config.yaml` after confirmation
- [x] Infers the git host from the git remote
