---
id: PMK-237
title: Improve request-queue
type: feature
status: backlog
priority: low
related: [PMK-70]
created: 2026-11-08T20:37:26.517Z
updated: 2026-11-08T20:37:26Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-70 (request-queue) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-70.

### Scope (in)

- Serve requests on Linear.
- Match existing issues by text similarity in the CLI.
- Look up customer names, so requests with only a customer show the name.
- A `--reason-file` flag on `requests decline`.
- A scenario for a customer `NOT_FOUND` problem.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Serve requests on Linear
- [ ] Match existing issues by text similarity in the CLI
- [ ] Look up customer names, so requests with only a customer show the name
- [ ] A `--reason-file` flag on `requests decline`
- [ ] A scenario for a customer `NOT_FOUND` problem
