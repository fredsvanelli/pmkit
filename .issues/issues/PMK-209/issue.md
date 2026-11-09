---
id: PMK-209
title: Improve deploys list and ci logs
type: feature
status: in_progress
priority: medium
estimate: 3
assignee: fred
related: [PMK-49]
branch: pmk-209-improve-deploys-list-and-ci-logs
created: 2026-11-08T20:37:22.501Z
updated: 2026-11-09T23:47:19Z
---

## Description

### Context

Improvements suggested by the implementer and reviewers of PMK-49 (deploys list and ci logs) during EPC-6, collected in `docs/superpowers/epc-6-follow-ups.md`. None of them is a defect. Source: PMK-49.

### Scope (in)

- Read the deployment statuses in one GraphQL query instead of one `gh api` call per deployment. Today one failed call loses the whole list.
- Link the failing check of a pull request to its `ci logs` run.
- `ci logs` without `--run` can return an old failure when a newer run of the same workflow passed, while `risks` reads only the newest run. Show `createdAt` and `headSha` so the age of the failure is visible.
- `--tail` splits the whole log in memory, which is heavy for logs of hundreds of MB.

### Out of scope

- The defects found in the same reviews, which are their own bug issues.

## Acceptance criteria

- [ ] Read the deployment statuses in one GraphQL query instead of one `gh api` call per deployment
- [ ] Link the failing check of a pull request to its `ci logs` run
- [ ] `ci logs` without `--run` can return an old failure when a newer run of the same workflow passed, while `risks` reads only the newest run
- [ ] `--tail` splits the whole log in memory, which is heavy for logs of hundreds of MB
