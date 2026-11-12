---
id: PMK-279
title: Report a failing git rev-parse for a tracker outside the repository
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T02:12:43.770Z
updated: 2026-11-12T02:12:43Z
---

## Description

### Context

When auto_commit writes files in a tracker outside the repository, it runs `git rev-parse --show-toplevel` in the tracker folder (`scripts/pmkit.mjs:4194`). Any failure, a bad global gitconfig for example, is read as "not in a git repository", and the note says nothing was committed, with no error. The implementer of PMK-271 left it as a follow-up. Source: PMK-271, PR #225.

### Scope (in)

- Only "not a git repository" leads to the current note. Any other failure of `rev-parse` is reported as an `UPSTREAM` failure, with git's message passed through `hideAbsolutePaths`.

### Out of scope

- Trackers inside the repository.

### Tasks

- [ ] Tell "not a git repository" apart from other rev-parse failures
- [ ] Report the other failures

## Acceptance criteria

- [ ] A `rev-parse` failure other than "not a git repository" in the tracker folder is reported, not shown as "nothing was committed", with a test
- [ ] A tracker folder outside any git repository keeps the current note
