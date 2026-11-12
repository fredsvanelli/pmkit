---
id: PMK-277
title: "Hide an absolute path that follows a bracket, comma, semicolon, angle bracket or at sign"
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T02:12:43.592Z
updated: 2026-11-12T02:12:43Z
---

## Description

### Context

PMK-271 hides absolute paths in the `UPSTREAM` message of a failed auto_commit with `hideAbsolutePaths` (`scripts/lib/paths.mjs:28-31`). A path starts only after the line start, a space, a quote, `(`, `=` or `:`. The review of PMK-271 found that a path right after `[`, `,`, `;`, `<` or `@` is shown whole, a gap PMK-268 already had. Source: PMK-271, PR #225.

### Scope (in)

- `[/Users/x/repo]`, `a,/Users/x`, `a;/Users/x`, `</Users/x>` and `user@/Users/x` show no part of the path.

### Out of scope

- Messages of commands other than auto_commit (see the sibling issue on git stderr).

### Tasks

- [ ] Widen the characters a path may follow
- [ ] Test each one

## Acceptance criteria

- [ ] An absolute path after `[`, `,`, `;`, `<` or `@` in git's stderr shows no part of the path in the `UPSTREAM` message, with a test
