---
id: PMK-175
title: Run npm audit through the shell on Windows in alerts list
type: bug
status: in_progress
priority: high
estimate: 1
assignee: fred
related: [PMK-48]
branch: pmk-175-run-npm-audit-through-the-shell-on
created: 2026-10-31T03:04:20.693Z
updated: 2026-10-31T03:08:53Z
---

## Description

### Context

`alerts list` (PMK-48) runs `npm audit --json` through `spawnSync(npmCommand(), ...)` in `scripts/lib/alerts.mjs`. On Windows, `npmCommand()` returns `npm.cmd`. Since Node 18.20.2, 20.12.2 and 21.7.3 (CVE-2024-27980), Node refuses to spawn a `.cmd` or `.bat` file without `shell: true` and fails with `EINVAL`. The project runs on Node 22. Every Windows user therefore gets `npm-audit failed: spawnSync npm.cmd EINVAL` and a result marked `incomplete: true`.

The second review of PR #81 found this, and the PR merged with it as a follow-up.

### Scope (in)

- Pass `shell: process.platform === 'win32'` to the `spawnSync` call of the npm audit scanner. The arguments are fixed (`audit`, `--json`), so the shell adds no injection risk.
- Keep the missing-npm message on Windows. With a shell, a missing `npm.cmd` no longer fails with `ENOENT`: the shell exits with a non-zero code and prints that the command is not recognized. Map that case to `npm is not installed or not on PATH`.
- Tests that stub `process.platform` (or the spawn options) and check that the Windows call uses the shell, and that the fake npm used by `scripts/cli-alerts.test.mjs` also has an `npm.cmd`.

### Out of scope

- Other scanners and other platforms.

## Acceptance criteria

- [x] `alerts list` runs `npm audit` on Windows with `shell: true`, and a test checks the spawn options for `win32`
- [x] A missing npm on Windows still reports `npm is not installed or not on PATH`
- [x] The CHANGELOG says the Windows fix under `## Unreleased`
