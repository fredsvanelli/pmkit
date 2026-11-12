---
id: PMK-289
title: Hide the absolute paths left in git and gh error texts
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-289-hide-the-absolute-paths-left-in-git-and
created: 2026-11-12T14:41:35.031Z
updated: 2026-11-12T14:50:40Z
---

## Description

### Context

PMK-278 hides the stderr of git in six places. Its reviews left texts that still show an absolute path: `link-repo` says `${ctx.root} is not the root of a git repository` (`scripts/pmkit.mjs:3797`); `todos` says `cannot list the files of ${root}` (`scripts/lib/todos.mjs:451`); a spawn error message goes out as it is (`scripts/pmkit.mjs:491`, `:2368`, `:3801`); and the stderr of `gh` is not hidden, only that of git (`scripts/lib/github/host.mjs:42`). Source: PMK-278, PR #233 (cycle 1 and 3 reviews).

### Scope (in)

- The repository root in the `link-repo` and `todos` messages becomes relative or is left out.
- A spawn error message goes through hideAbsolutePaths.
- The stderr of `gh` goes through hideAbsolutePaths, with its HTTP status still read.

### Out of scope

- The rules of hideAbsolutePaths itself.

### Tasks

- [ ] Drop the root from the two messages
- [ ] Hide spawn error messages
- [ ] Hide gh stderr
- [ ] Test each place

## Acceptance criteria

- [ ] No message of `link-repo`, `todos` or a failed `gh` call shows an absolute path, with a test per place
- [ ] A `gh api` error still sets its HTTP status, with a test
