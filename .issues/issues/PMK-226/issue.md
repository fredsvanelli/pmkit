---
id: PMK-226
title: Improve bulk operation
type: feature
status: backlog
priority: low
estimate: 8
related: [PMK-56]
created: 2026-11-08T20:37:25.008Z
updated: 2026-11-08T20:53:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-56 (bulk operation) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-56.

### Scope (in)

- `due`, `type` and `archive` as bulk changes.
- Resume a stopped batch.
- Linear `milestone` and `release`.
- Keep the digest and the filter in one object, so the agent does not pass the flags twice.
- A cheaper preview for very large sets, and a cheaper `link --kind blocks` on Local.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] `due`, `type` and `archive` as bulk changes
- [ ] Resume a stopped batch
- [ ] Linear `milestone` and `release`
- [ ] Keep the digest and the filter in one object, so the agent does not pass the flags twice
- [ ] A cheaper preview for very large sets, and a cheaper `link --kind blocks` on Local
