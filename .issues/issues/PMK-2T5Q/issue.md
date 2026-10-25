---
id: PMK-2T5Q
title: Add the dependency-map command
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-E0Y1
milestone: phase-2-commands
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

Source: Unified model, Foundation catalog (`dependency-map`: "Chain of blockers and hierarchy, with critical path"; degradation "Hierarchy only, or related links"); Linear tab ("What is blocking project X?").

## Acceptance criteria

- [ ] The CLI computes the blocker chain and the critical path of an issue or epic
- [ ] The command shows the chain and highlights the critical path
- [ ] Without dependencies it shows the hierarchy only, and says so
- [ ] Writes nothing
