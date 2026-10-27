---
id: PMK-20
title: Add the dependency-map command
type: feature
status: done
priority: medium
estimate: 5
assignee: fred
parent: EPC-3
milestone: phase-2-commands
branch: pmk-20-add-the-dependency-map-command
created: 2026-10-25T19:13:20Z
updated: 2026-10-27T14:21:14Z
---

## Description

Source: Unified model, Foundation catalog (`dependency-map`: "Chain of blockers and hierarchy, with critical path"; degradation "Hierarchy only, or related links"); Linear tab ("What is blocking project X?").

## Acceptance criteria

- [x] The CLI computes the blocker chain and the critical path of an issue or epic
- [x] The command shows the chain and highlights the critical path
- [x] Without dependencies it shows the hierarchy only, and says so
- [x] Writes nothing
