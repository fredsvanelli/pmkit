---
id: PMK-182
title: Fix todos scan on a missing path and the incomplete docs
type: bug
status: backlog
priority: medium
estimate: 1
related: [PMK-64]
created: 2026-10-31T16:01:18.288Z
updated: 2026-10-31T16:01:18Z
---

## Description

### Context

`todos scan` and `/pmkit:issues:todos` (PMK-64) merged with these defects, found by the third and fourth reviews of PR #90. Source: PMK-64, PR #90.

### Scope (in)

- `README.md:125`, the CHANGELOG and the spec still say `incomplete` means a cut read. Since the fourth review it also means unreadable issues, reported in `unread`.
- `--path` that does not exist answers "no TODO or FIXME found" with exit 0. `--path` is relative to the repository root, and the docs do not say so.
- SQL `/* */` and Lua `--[[ ]]` block comments are not read, and those files count as read, so they are not in the unread-types warning.
- `scripts/lib/todos.mjs:276`: the comment says unreadable issues count as a cut read, but they stay out of `cut`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] The README, the CHANGELOG and the spec describe `incomplete`, `cut` and `unread`
- [ ] A `--path` that does not exist answers `INVALID_INPUT`, and the docs say the path is relative to the repository root
- [ ] SQL and Lua block comments are read, or those files are listed as not fully read
