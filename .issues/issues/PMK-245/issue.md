---
id: PMK-245
title: Test the CLI with a symlinked working folder
type: task
status: backlog
priority: low
related: [PMK-201]
created: 2026-11-08T22:28:25.955Z
updated: 2026-11-08T22:28:26Z
---

## Description

### Context

Found in the review of PR #123 (PMK-201). Before PMK-201, in-process CLI tests on macOS ran from a temp folder behind the `/var` symlink, which covered the `realpath` handling in `scripts/pmkit.mjs:2393` and `scripts/lib/user-store.mjs:43` by accident. `tempDir()` now returns real paths, so only the explicit symlink tests cover it. Source: PMK-201.

### Scope (in)

- One test that runs the CLI from a symlinked working folder on every platform that supports symlinks.

## Acceptance criteria

- [ ] A test runs the CLI with a symlinked cwd and checks the root and the user store key
