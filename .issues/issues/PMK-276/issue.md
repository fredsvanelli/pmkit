---
id: PMK-276
title: Test the Supersedes line of a repository ADR that replaces a tracker ADR
type: chore
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-276-test-the-supersedes-line-of-a-repository
created: 2026-11-12T02:12:43.504Z
updated: 2026-11-14T05:19:18Z
---

## Description

### Context

PMK-270 computes `supersedesRef` with `adrRef` (`scripts/lib/adr.mjs:93`). When the new ADR is in the repository and the old one is in a tracker outside it, `supersedesRef` is `ref`, the path from the repository root (`../outside/docs/adr/0001-a.md`), as the issue asked. That mixed case has no test of its own. Source: PMK-270, PR #224.

### Scope (in)

- A test of `docs adr-get <old> --from docs/adr/<new>` with the old ADR in a tracker outside the repository: `supersedesRef` equals `ref`.

### Out of scope

- Changing the base rule for the mixed case.

### Tasks

- [ ] Add the mixed-case test

## Acceptance criteria

- [x] A test fixes that a repository ADR replacing an ADR in a tracker outside the repository gets `supersedesRef` equal to `ref`
