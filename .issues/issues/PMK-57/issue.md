---
id: PMK-57
title: Add the delegate-to-agent command
type: feature
status: in_progress
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
milestone: generic-commands
branch: pmk-57-add-the-delegate-to-agent-command
created: 2026-10-25T19:13:22Z
updated: 2026-10-30T22:09:09Z
---

## Description

Source: Unified model, Foundation catalog (`delegate-to-agent`; degradation "Assigns and comments with instructions for local execution"); Local adapter (`agent_delegation`: "`agent:<name>` assignee; the plugin itself runs the work locally").

## Acceptance criteria

- [ ] Assigns the issue to `agent:<name>` after confirmation
- [ ] Without native delegation it comments the instructions for local execution
