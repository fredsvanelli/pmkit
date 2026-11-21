---
id: PMK-351
title: Run the GitHub live checks against github.com and GHES and record the result
type: task
status: done
priority: medium
estimate: 2
assignee: fred
parent: EPC-8
related: [PMK-335]
branch: pmk-351-run-the-github-live-checks-against
created: 2026-11-20T22:03:02.220Z
updated: 2026-11-21T22:17:20Z
---

## Description

### Context

PMK-335 (PR #327) built the GitHub live checks gated by `PMKIT_LIVE`, but verified them only against fakes. Nobody has run them against github.com or a GHES host yet, so the error shapes, `discover`, `openCycle` and the GHES draft conversion are still unconfirmed on a real host.

### Scope (in)

- Run the checks against github.com with a throwaway Project, following `docs/runbooks/live-checks-github.md`
- Run the GHES checks when a GHES host is available, or record that none was
- Record the result: date, pmkit version, host and GHES version, and pass, fail or skip per check

### Out of scope

- Fixing a failing check, which gets its own issue

### Tasks

- [ ] Run the live checks against github.com
- [ ] Run the live checks against GHES, or record why not
- [ ] Record the result and open an issue per failure

## Acceptance criteria

- [x] The live checks ran against github.com, and the result per check is recorded
- [x] The GHES checks ran against a GHES host, or the record says why they were skipped
- [x] Every failing check has its own issue linked to this one
- [x] The throwaway Project is empty after the run
