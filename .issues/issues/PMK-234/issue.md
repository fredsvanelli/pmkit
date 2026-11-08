---
id: PMK-234
title: Improve prioritize-by-demand
type: feature
status: backlog
priority: medium
estimate: 8
related: [PMK-68]
created: 2026-11-08T20:37:26.100Z
updated: 2026-11-08T20:53:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-68 (prioritize-by-demand) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-68.

### Scope (in)

- Weight demand by customer revenue or tier.
- A ranking-only mode that proposes nothing.
- A stale-write guard between the preview and the write, with `issues bulk --expect`.
- Serve `demand list` on Linear, so Linear ranks by requests instead of comments.
- A CLI read for whole-token mentions, instead of matching by hand over a large dump.
- Count mentions in archived issues and in Linear acceptance criteria.
- A Linear-faked test of the fallback path.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Weight demand by customer revenue or tier
- [ ] A ranking-only mode that proposes nothing
- [ ] A stale-write guard between the preview and the write, with `issues bulk --expect`
- [ ] Serve `demand list` on Linear, so Linear ranks by requests instead of comments
- [ ] A CLI read for whole-token mentions, instead of matching by hand over a large dump
- [ ] Count mentions in archived issues and in Linear acceptance criteria
- [ ] A Linear-faked test of the fallback path
