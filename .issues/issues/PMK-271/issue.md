---
id: PMK-271
title: Hide every absolute path in the auto_commit failure message
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-271-hide-every-absolute-path-in-the-auto
created: 2026-11-12T00:43:33.141Z
updated: 2026-11-12T01:09:18Z
---

## Description

### Context

PMK-268 took the repository folder out of the `UPSTREAM` message of a failed auto_commit and hides other absolute paths. Its review left three cases. Source: PMK-268, PR #220.

### Scope (in)

- The regex that hides other absolute paths stops at the first space (`scripts/pmkit.mjs:4206`). `fatal: bad config line 1 in file /Users/John Doe/.gitconfig` becomes `<path> Doe/.gitconfig`, which shows part of the path.
- A Windows UNC path (`\\host\share\...`) is not hidden.
- With more than 5 files outside the repository, the next step says only "the tracker files" (`scripts/pmkit.mjs:4194`). It can name the tracker folder from `tracker.path`, which is relative.

### Out of scope

- Messages of commands other than auto_commit.

### Tasks

- [ ] Hide absolute paths with spaces
- [ ] Hide UNC paths
- [ ] Name the tracker folder in the next step

## Acceptance criteria

- [x] An absolute path with a space in git's stderr shows no part of the path in the `UPSTREAM` message, with a test
- [x] A UNC path in git's stderr is hidden, with a test
- [x] With more than 5 files outside the repository, the next step names the tracker folder from `tracker.path`
