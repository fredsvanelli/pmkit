---
id: PMK-176
title: Fix estimate-issue on an empty or conditional estimate scale
type: bug
status: in_review
priority: medium
estimate: 2
assignee: fred
related: [PMK-59]
branch: pmk-176-fix-estimate-issue-on-an-empty-or
created: 2026-10-31T16:01:11.186Z
updated: 2026-11-09T00:28:04Z
---

## Description

### Context

`/pmkit:issues:estimate` (PMK-59) merged with these defects, found by the review of PR #84. They show up on a Linear workspace whose estimate scale is not fixed by `tracker.scope.team`. Source: PMK-59, PR #84.

### Scope (in)

- `commands/issues/estimate.md` step 1 handles only `native` and `absent`. With `conditional` (some teams estimate, some do not), the dry run fails with `INVALID_INPUT` "team X has estimates off", and the command never reaches the comment path. With no `mappings.fields.estimate`, the dry run fails with `NOT_SUPPORTED`.
- Step 3 proposes "ideal days" outside the `absent` path. With an empty scale on the `native` path, the command sends a number of days to `issues update --estimate`, which saves 3 points where the user read 3 days, or fails on a t-shirt team.
- When the proposal equals the current value, the command stops before the only place where the user can pick another value.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] A `conditional` estimation, or a missing `mappings.fields.estimate`, falls back to commenting the estimate
- [x] The proposal uses the scale of the issue's team, and never writes days as points
- [x] The user can pick another value when the proposal equals the current one
