---
id: PMK-212
title: Improve saved views
type: feature
status: backlog
priority: low
related: [PMK-44]
created: 2026-11-08T20:37:22.964Z
updated: 2026-11-08T20:37:23Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-44 (saved views) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-44.

### Scope (in)

- `views delete` and `views rename`.
- `validate` reports two view names that differ only in case, and `filter: {}`, and counts views in `checked`.
- Let `views run` override the limit and the sort.
- Serve Linear saved views through the API.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] `views delete` and `views rename`
- [ ] `validate` reports two view names that differ only in case, and `filter: {}`, and counts views in `checked`
- [ ] Let `views run` override the limit and the sort
- [ ] Serve Linear saved views through the API
