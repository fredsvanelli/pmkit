---
id: PMK-298
title: Say when the local default branch is behind origin in issues branch
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T22:25:13.996Z
updated: 2026-11-12T22:25:13Z
---

## Description

### Context

`issues branch` starts from the local default branch when it exists (`branchBase`, `scripts/pmkit.mjs:345`, PMK-290). Nothing is fetched, so a local `develop` behind `origin/develop` gives a branch that starts from an old commit. In round 26 the PR of PMK-293 started from 79bb6df, two merges behind, and had to be rebased. Source: PMK-293, PR #248 (orchestrator).

### Scope (in)

- Without `--from`, when `origin/<default>` has commits the local default lacks, the text and the notes say how many and give the next step (`git pull`, or `--from origin/<default>`). The dry run says the same.
- Still no fetch.

### Out of scope

- A configurable remote: `pr open` and `issues branch` both use origin.
- An explicit `--from`.

### Tasks

- [ ] Count the commits of origin/<default> missing from the local default
- [ ] Test with a clone whose local default is behind

## Acceptance criteria

- [ ] `issues branch` with a local default behind origin says so with the count and a next step, also on the dry run, with a test
- [ ] With the local default up to date, or with --from, there is no such note, with a test
