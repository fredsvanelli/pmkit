---
id: PMK-335
title: Add live checks of the GitHub adapter against github.com and GHES
type: task
status: in_progress
priority: low
assignee: fred
parent: EPC-8
milestone: github-issues
branch: pmk-335-add-live-checks-of-the-github-adapter
created: 2026-11-16T18:34:34.787Z
updated: 2026-11-18T02:13:39Z
---

## Description

Found while working PMK-85 (PR #309), PMK-86 (PR #310), PMK-88 and PMK-91 (PR #317). The GitHub client's error mapping, `discover`, adding a sprint iteration and converting draft issues are tested only against an injected runner and a fake `gh`. Add live checks gated by `PMKIT_LIVE`, like the Linear live checks:

- against github.com: the error shapes (no login, missing `project` scope, not found, rate limit headers) and what `discover` reads (issue types, issue fields, Project fields and Status options)
- against github.com: `openCycle` keeps every item's iteration assignment (PMK-88 relies on the schema description alone), on a throwaway Project
- against a live GHES 3.19 when one is available: converting a draft issue (PMK-91 was checked only against the published schema)

## Acceptance criteria

- [ ] A `PMKIT_LIVE` check runs the GitHub client against github.com and confirms the error shapes
- [ ] A `PMKIT_LIVE` check runs `discover` against a github.com repository with a Project
- [ ] A `PMKIT_LIVE` check confirms that `openCycle` keeps item iteration assignments on a throwaway Project
- [ ] A `PMKIT_LIVE` check converts a draft issue on GHES 3.19, skipped with a note when no GHES host is configured
