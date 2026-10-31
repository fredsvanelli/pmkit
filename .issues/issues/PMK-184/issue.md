---
id: PMK-184
title: Fix deploys list with an empty environment flag
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-49]
created: 2026-10-31T16:01:20.678Z
updated: 2026-10-31T16:01:21Z
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

- [ ] `deploys list --environment` with no value answers `INVALID_INPUT`
- [ ] `ci logs` says when a failed run has no log
- [ ] With `--run`, the result has the workflow name and URL, and says when the run did not fail
