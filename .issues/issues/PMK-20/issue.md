---
id: PMK-20
title: Add the dependency-map command
type: feature
status: in_progress
priority: medium
estimate: 5
assignee: fred
parent: EPC-3
milestone: phase-2-commands
branch: pmk-20-add-the-dependency-map-command
created: 2026-10-25T19:13:20Z
updated: 2026-10-27T00:13:19Z
---

## Description

Source: Unified model, Foundation catalog (`dependency-map`: "Chain of blockers and hierarchy, with critical path"; degradation "Hierarchy only, or related links"); Linear tab ("What is blocking project X?").

## Acceptance criteria

- [ ] The CLI computes the blocker chain and the critical path of an issue or epic
- [ ] The command shows the chain and highlights the critical path
- [ ] Without dependencies it shows the hierarchy only, and says so
- [ ] Writes nothing
