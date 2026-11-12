---
id: PMK-290
title: Create the issue branch when the default branch is only on the remote
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T14:41:35.114Z
updated: 2026-11-12T14:41:35Z
---

## Description

### Context

`issues branch` runs `git switch -c <branch> <from>` (`scripts/lib/github/host.mjs:154`), with `from` the default branch (`scripts/pmkit.mjs:1937`). In a worktree or clone without a local `develop`, git fails with `fatal: invalid reference: develop`, and the user has to pass `--from origin/develop`. Source: PMK-274, PR #232 (implementer).

### Scope (in)

- Without `--from` and with no local default branch, the branch is created from `<remote>/<default branch>`.
- An explicit `--from` that does not exist still fails, with a next step.

### Out of scope

- Fetching the remote.

### Tasks

- [ ] Fall back to the remote branch
- [ ] Test with a clone that has only the remote branch

## Acceptance criteria

- [ ] `issues branch` with no local default branch creates the branch from the remote one and says so, with a test
- [ ] A missing `--from` branch fails with a next step, with a test
