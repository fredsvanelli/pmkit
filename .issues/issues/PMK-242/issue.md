---
id: PMK-242
title: Rank by demand on Linear
type: feature
status: backlog
priority: low
estimate: 3
related: [PMK-68, PMK-234]
created: 2026-11-08T20:58:09.632Z
updated: 2026-11-08T20:58:09Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-68 (prioritize-by-demand) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-68. Split from PMK-234.

### Scope (in)

- Serve `demand list` on Linear, so Linear ranks by requests instead of comments.
- A Linear-faked test of the fallback path.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Serve `demand list` on Linear, so Linear ranks by requests instead of comments
- [ ] A Linear-faked test of the fallback path
