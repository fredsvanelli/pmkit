---
id: PMK-358
title: Replay priority and estimate label changes in the GitHub history
type: feature
status: backlog
priority: low
estimate: 2
related: [PMK-339]
created: 2026-11-21T22:10:41.288Z
updated: 2026-11-21T22:10:41Z
---

## Description

### Context

Left open by the Secure step of PMK-339 (PR #338, ADR 0012). On a GitHub repository without a Project, priority and estimate labels give the priority and the estimate, but `issues get --history` and the flow metrics show their changes as label events, as ADR 0012 Consequences says.

### Scope (in)

- Replay priority and estimate label events as priority and estimate updates in the history

### Out of scope

- Status and type labels, which already replay

## Acceptance criteria

- [ ] `issues get --history` shows a priority label swap as a priority update from the old level to the new one
- [ ] An estimate label change shows as an estimate update
- [ ] Neither shows as a label update
