---
id: PMK-184
title: Fix deploys list with an empty environment flag
type: bug
status: in_review
priority: medium
estimate: 1
assignee: fred
related: [PMK-49]
branch: pmk-184-fix-deploys-list-with-an-empty
created: 2026-10-31T16:01:20.678Z
updated: 2026-11-09T01:30:25Z
---

## Description

### Context

`deploys list` and `ci logs` (PMK-49) merged with these defects, found by the second review of PR #79. Source: PMK-49, PR #79.

### Scope (in)

- `scripts/pmkit.mjs:965` only refuses the empty string. `deploys list --environment` with no value becomes `true` in `parseArgs`, the call goes out as `deployments?per_page=20&environment=true`, and the command answers "no deployments" with exit 0.
- `ci logs` counts `startup_failure` as failed, but those runs have no log; the command does not say so.
- With `--run`, `workflowName` and `url` are always null, and a run that passed returns an empty log with exit 0.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] `deploys list --environment` with no value answers `INVALID_INPUT`
- [x] `ci logs` says when a failed run has no log
- [x] With `--run`, the result has the workflow name and URL, and says when the run did not fail
