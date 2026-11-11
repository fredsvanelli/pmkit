---
id: PMK-257
title: Fix adr-status with a tracker outside the repo and in its report
type: bug
status: in_progress
priority: medium
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-257-fix-adr-status-with-a-tracker-outside
created: 2026-11-11T22:34:42.521Z
updated: 2026-11-11T22:59:13Z
---

## Description

### Context

The reviews of PMK-247 and PMK-248 approved `docs adr-status` with defects left over, outside their scope. Two lose or leak data when the tracker folder is outside the repository, and three make the command's report or the ADR text wrong. Source: PMK-247 (PR #207), PMK-248 (PR #203).

### Scope (in)

- With the tracker outside the repository and `auto_commit: true`, `adr-status` writes the ADR, then fails with `UPSTREAM` because git gets a path outside the repository, and the message leaks an absolute path (`scripts/pmkit.mjs:371`).
- `--by` for an ADR that exists only in a tracker outside the repository writes `docs/adr/<name>`, which a reader resolves against the repository, where it does not exist.
- When the status does not change, `before` and `after` still differ in the report (`accepted -> Accepted`).
- With a status in both the front matter and a `## Status` section, the report shows only the front matter key, even when the section changed.
- `status: accepted # comment` is not seen as the same status, and the rewrite drops the comment.

### Out of scope

- A third status form (a `Status:` line above the first section next to front matter).

### Tasks

- [ ] Commit an ADR status change in a tracker outside the repository
- [ ] Write a superseded-by reference a reader can follow
- [ ] Report the status change as it happened
- [ ] Keep a YAML comment on the status line

## Acceptance criteria

- [x] With the tracker outside the repository and `auto_commit: true`, `adr-status` writes and commits the ADR without an error, and no message shows an absolute path
- [x] A superseded-by reference to an ADR in a tracker outside the repository says where the file is, so a reader can open it
- [x] An unchanged status reports the same value before and after
- [x] When both the front matter and the `## Status` section change, the report shows both
- [x] `status: accepted # comment` counts as accepted and keeps its comment
