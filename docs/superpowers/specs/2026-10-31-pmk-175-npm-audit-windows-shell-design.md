# PMK-175: run npm audit through the shell on Windows

Date: 2026-10-31
Issue: PMK-175 (bug, high, follow-up of PMK-48 and PR #81)

## Intent

`pmkit alerts list` runs `npm audit --json` through `spawnSync(npmCommand(), ...)`. On Windows, `npmCommand()` returns `npm.cmd`. Since Node 18.20.2, 20.12.2 and 21.7.3 (CVE-2024-27980), Node refuses to spawn a `.cmd` or `.bat` file without `shell: true` and fails with `EINVAL`. The scanner therefore never runs on Windows, and the result is marked `incomplete`. This change makes the spawn go through the shell on Windows, and keeps the missing-npm message correct there.

## Goals

- On `win32`, the npm audit call passes `shell: true`. On other platforms the options stay as they are.
- A test checks the spawn options that the `win32` call uses, without running on Windows.
- On Windows, a missing `npm.cmd` still reports `npm is not installed or not on PATH`.
- The CHANGELOG gets one line under `## Unreleased`.

## Non-goals

- Other scanners, and other platforms.
- Localized `cmd.exe` messages (see "Follow-ups").

## Anti-goals

- Passing user input to the shell. The arguments stay fixed (`audit`, `--json`), so the shell adds no injection path.
- Changing the output or the warnings of the scanner on Linux and macOS.

## Decisions

These are my calls. The issue does not settle them, and each one keeps the change small.

1. **Injectable platform and spawn.** `collectAlerts(root, options)` gains two optional options, `platform` (default `process.platform`) and `spawn` (default `spawnSync`). It passes them to each scanner's `run` next to `timeoutMs`. The tests use them to simulate Windows on Linux. No other caller changes.
2. **Shell flag.** The spawn options get `shell: platform === 'win32'`. The rest of the options (`cwd`, `env`, `encoding`, `maxBuffer`, `timeout`) do not change.
3. **Missing npm on Windows.** With a shell, a missing `npm.cmd` produces no `result.error`. The shell exits with a non-zero status, and `result.stderr` contains `is not recognized`. The scanner checks for that case before it parses the output, and throws `npm is not installed or not on PATH`. The check only applies when `platform === 'win32'`, so Linux behavior does not change. The `ENOENT` branch stays for the other platforms.
4. **Match text.** The match is `/is not recognized/i` on `stderr`. Windows `cmd.exe` in other display languages prints a different text, so the match misses it. That case becomes a follow-up, not part of this change.
5. **Ordering.** The check for "not recognized" runs only when `result.error` is absent and `result.status` is non-zero. A real npm run that exits 1 with vulnerabilities prints no such text, so it still goes to the parser.
6. **Tests.** A new test in `scripts/alerts.test.mjs` calls `SCANNERS[0].run` (or `collectAlerts`) with a fake `spawn` and `platform: 'win32'`, and checks that `command` is `npm.cmd` and that `options.shell` is `true`. A second test returns `{ status: 1, stderr: "'npm.cmd' is not recognized as an internal or external command", stdout: '' }` and checks the warning text. A third test confirms `platform: 'linux'` gives `shell: false` and command `npm`. `scripts/cli-alerts.test.mjs` already runs the fake npm on Linux. The fake gets no `npm.cmd` file, because the Windows path is tested with the injected spawn. The issue's wording asked for an `npm.cmd` in the fake, but that file has no effect on Linux, so I leave it out and say so in the PR.
7. **CHANGELOG.** One bullet under `## Unreleased`, in the style of the entries already there, with `(PMK-175)`.

## Constraints

- No new dependency.
- Node 22 is the target, as the issue says.
- `npm test` passes before the PR opens.

## Left to the builder

- The exact name of the injected spawn parameter, if a different one reads better next to the existing `timeoutMs`.
- Whether the helper that detects "not recognized" lives in `scripts/lib/alerts.mjs` as a small named function. It should, so the test can point at it.
