---
id: PMK-229
title: Improve investigate-bug
type: feature
status: backlog
priority: low
related: [PMK-63]
created: 2026-11-08T20:37:25.416Z
updated: 2026-11-08T20:37:25Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-63 (investigate-bug) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-63.

### Scope (in)

- Scenarios for the degraded paths (no branch, `git_host: none`).
- A `--redact` flag on `issues comment`, so the CLI redacts any comment body.
- Read the code of the issue's branch instead of the working tree.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Scenarios for the degraded paths (no branch, `git_host: none`)
- [ ] A `--redact` flag on `issues comment`, so the CLI redacts any comment body
- [ ] Read the code of the issue's branch instead of the working tree
