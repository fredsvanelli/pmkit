---
id: PMK-286
title: Hide the path of a git+file:// URL
type: bug
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-12T14:41:34.778Z
updated: 2026-11-12T14:41:34Z
---

## Description

### Context

In `hideAbsolutePaths` only a scheme that is exactly `file` is a local path (`SCHEME_URL`, `scripts/lib/paths.mjs:22`). `git+file://host/Users/a/r.git` matches as an ordinary URL and shows whole, path included. Source: PMK-278, PR #233 (cycle 3 review).

### Scope (in)

- A scheme that ends in `+file` (`git+file://`) is hidden as `file://` is.

### Out of scope

- Other schemes.

### Tasks

- [ ] Treat `<scheme>+file://` as a local path
- [ ] Test it with and without a host

## Acceptance criteria

- [ ] `git+file://host/Users/a/r.git` and `git+file:///Users/a/r.git` hide the path, with a test
