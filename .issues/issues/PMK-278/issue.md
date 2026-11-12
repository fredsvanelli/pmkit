---
id: PMK-278
title: Hide absolute paths in the git errors of other commands
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-278-hide-absolute-paths-in-the-git-errors-of
created: 2026-11-12T02:12:43.682Z
updated: 2026-11-12T02:42:07Z
---

## Description

### Context

PMK-271 hides absolute paths only in the auto_commit failure message. Other commands still put git's own stderr in their messages, for example the first stderr line in `scripts/pmkit.mjs:493`, the tag check in `scripts/pmkit.mjs:2373`, the reason in `scripts/pmkit.mjs:3801` and the stderr in `scripts/lib/todos.mjs:449`. The implementer of PMK-271 left it as a follow-up. Source: PMK-271, PR #225.

### Scope (in)

- Every message that repeats git's stderr passes it through `hideAbsolutePaths` (`scripts/lib/paths.mjs`).

### Out of scope

- Paths the user typed and the command repeats on purpose.

### Tasks

- [ ] List the messages that repeat git's stderr
- [ ] Pass each through hideAbsolutePaths

## Acceptance criteria

- [x] No command message repeats an absolute path from git's stderr, with a test for at least two commands
- [x] The auto_commit message keeps its PMK-271 behaviour
