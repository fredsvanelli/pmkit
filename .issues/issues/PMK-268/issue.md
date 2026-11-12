---
id: PMK-268
title: Fix adr-status paths and messages with a tracker outside the repo
type: bug
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
branch: pmk-268-fix-adr-status-paths-and-messages-with-a
created: 2026-11-12T00:00:31.443Z
updated: 2026-11-12T00:40:21Z
---

## Description

### Context

PMK-257 made `docs adr-status` commit and point to ADRs in a tracker outside the repository. Its implementer and its review left four defects. Source: PMK-257, PR #215; PMK-263, PR #216.

### Scope (in)

- When the commit fails, git's stderr goes into the `UPSTREAM` message and can hold an absolute path (`scripts/pmkit.mjs:4204`, `commitIn`). PMK-257 asked that no message show an absolute path.
- With both ADRs in a tracker outside the repository, `--by` writes `../<tracker>/docs/adr/...`, a path relative to the project checkout, not to the ADR that holds it (`scripts/lib/adr.mjs:57`, `refFolder`). A reader of the tracker on its own cannot follow it.
- `climbsOut` compares with `path.sep`, but `writtenFiles()` returns paths with `/` (`scripts/pmkit.mjs:3372`), so a path outside the repository is not seen as one on Windows.
- Other write commands with `auto_commit: true` also commit into a tracker outside the repository through `commitTracker` (`scripts/pmkit.mjs:4174`), but only `adr-status` has tests for it.

### Out of scope

- A tracker folder that is not a repository while a parent folder is (the commit goes to the parent, as the PMK-257 spec says).

### Tasks

- [ ] Keep absolute paths out of the auto_commit failure message
- [ ] Write a superseded-by reference that works from the tracker
- [ ] Detect a path outside the repository on Windows
- [ ] Test auto_commit into a tracker outside the repository for the other write commands

## Acceptance criteria

- [x] When auto_commit fails with a tracker outside the repository, the `UPSTREAM` message names the files relative to the repository or the tracker, never an absolute path
- [x] When both ADRs are in a tracker outside the repository, the `--by` reference resolves from the ADR that holds it
- [x] `climbsOut` sees a path outside the repository whatever the separator, with a test
- [x] At least one other write command has a test that commits into a tracker outside the repository with `auto_commit: true`
