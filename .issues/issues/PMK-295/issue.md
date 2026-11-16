---
id: PMK-295
title: "Hide a path after `!`, after a letter before `>` and after a pipe that ends a URL"
type: bug
status: done
priority: medium
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-295-hide-a-path-after-after-a-letter-before
created: 2026-11-12T22:25:13.683Z
updated: 2026-11-13T04:15:04Z
---

## Description

### Context

`hideAbsolutePaths` (`scripts/lib/paths.mjs`) leaves three paths whole at 7f26b46:

- `!/Users/x` (`!` is not in `START`, `scripts/lib/paths.mjs:22`).
- `from>/Users/x`: since PMK-284, `>` starts a path only as a redirect (after a line start, a space, a digit, `&` or `>`), never after a letter. The rule keeps `<remote>/<branch>` visible, which must stay.
- `https://h.com/x|/Users/y`: the URL rule takes `\S*`, so the path after the pipe goes out with the URL (already so before PMK-284).

Source: PMK-284, PR #239 (implementer and review cycles 1 and 2).

### Scope (in)

- A path after `!`, after a letter and `>`, and after a `|` that ends a URL is hidden.
- `<remote>/<branch>`, `<rev1>/<rev2>` and the rest of the PMK-284 battery keep their output.

### Out of scope

- Other starts and the URL user (PMK-287).

### Tasks

- [ ] Add the three cases with tests first
- [ ] Run the PMK-284 battery of common git and gh lines against develop

## Acceptance criteria

- [x] `!/Users/x`, `from>/Users/x` and `https://h.com/x|/Users/y` hide the path, with tests
- [x] `<remote>/<branch>` and `<rev1>/<rev2>` stay as they are, with a test
