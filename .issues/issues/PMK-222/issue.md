---
id: PMK-222
title: Improve issues delete
type: feature
status: backlog
priority: low
estimate: 5
related: [PMK-52]
created: 2026-11-08T20:37:24.468Z
updated: 2026-11-08T20:53:52Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-52 (issues delete) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-52.

### Scope (in)

- Scan `docs/` and the code for the deleted ID.
- Restore an issue from the Linear trash.
- Let `issues link --remove` take several targets, to clear the references in one call.
- Run the delete in the Linear live sandbox (PMK-39).
- Tests for an ID with `../`, an epic ID and `issueDelete` with `success: false`.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Scan `docs/` and the code for the deleted ID
- [ ] Restore an issue from the Linear trash
- [ ] Let `issues link --remove` take several targets, to clear the references in one call
- [ ] Run the delete in the Linear live sandbox (PMK-39)
- [ ] Tests for an ID with `../`, an epic ID and `issueDelete` with `success: false`
