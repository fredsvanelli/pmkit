---
id: PMK-333
title: Fix the npm test failures on WSL and case-sensitive file systems
type: bug
status: in_review
assignee: fred
related: [PMK-84]
branch: pmk-333-fix-the-npm-test-failures-on-wsl-and
created: 2026-11-16T18:00:01.438Z
updated: 2026-11-18T01:38:50Z
---

## Description

Found while working PMK-84 (PR #308) and PMK-85 (PR #309). Four tests fail on a clean `develop` checkout under WSL:

- `github-host`, "the default exec throws ENOENT": a Windows folder in the WSL `PATH` makes `spawnSync` return `EACCES`.
- `cli-pr`, the stacked PR diff and the "pr open behind count" tests: they fail with "no current branch (detached HEAD)".
- `validate-views`, "two view files whose names differ only in case": it runs only on case-sensitive file systems and reads `problems[0]`, but the `team` fixture's conflict file sorts first. This one is a real test bug.

## Acceptance criteria

- [x] `npm test` passes on WSL with a Windows folder in `PATH`
- [x] The `cli-pr` tests pass when the checkout has a detached HEAD
- [x] The `validate-views` case test finds its problem by content, not by position
