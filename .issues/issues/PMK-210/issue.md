---
id: PMK-210
title: Improve docs list
type: feature
status: in_progress
priority: low
estimate: 3
assignee: fred
related: [PMK-50]
branch: pmk-210-improve-docs-list
created: 2026-11-08T20:37:22.649Z
updated: 2026-11-10T02:14:53Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-50 (docs list) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-50.

### Scope (in)

- Serve `listDocuments` on the Linear adapter.
- Add a `listDocuments` case to `scripts/contract-suite.mjs`.
- Update the documents table in `docs/superpowers/specs/2026-10-23-pmkit-design.md`, which lists only read and create.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Serve `listDocuments` on the Linear adapter
- [ ] Add a `listDocuments` case to `scripts/contract-suite.mjs`
- [ ] Update the documents table in `docs/superpowers/specs/2026-10-23-pmkit-design.md`, which lists only read and create
