---
id: PMK-239
title: Resume a stopped bulk batch
type: feature
status: backlog
priority: low
estimate: 3
related: [PMK-56, PMK-226]
created: 2026-11-08T20:58:08.915Z
updated: 2026-11-08T20:58:09Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-56 (bulk operation) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-56. Split from PMK-226.

### Scope (in)

- Resume a stopped batch.
- Keep the digest and the filter in one object, so the agent does not pass the flags twice.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Resume a stopped batch
- [ ] Keep the digest and the filter in one object, so the agent does not pass the flags twice
