# PMK-208 alerts list scanners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `alerts list` and `alerts scan` read `yarn audit`, `pnpm audit`, `pip-audit` and `cargo audit` as well as `npm audit`, and read saved reports with `--report <scanner>=<file>`.

**Architecture:** Four more entries in `SCANNERS` (`scripts/lib/alerts.mjs`), one shared `runScanner` helper for spawning, one shared `groupAdvisories` helper that folds per-advisory entries into one alert per package. `collectAlerts` takes `reports` (scanner ID to file path) and parses those files instead of running anything. The CLI parses `--report` once for both commands.

**Tech Stack:** Node.js ESM, `node:test`, no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-pmk-208-alerts-list-scanners-design.md`

## Global Constraints

- Scanner IDs: `npm-audit`, `yarn-audit`, `pnpm-audit`, `pip-audit`, `cargo-audit`, in that order.
- `SEVERITIES = ['critical', 'high', 'medium', 'low', 'unknown']`.
- Spawn: `maxBuffer: NPM_MAX_BUFFER` (256 MiB), `timeout: NPM_TIMEOUT_MS` (60 s, a read). Shell only for `npm`, `yarn`, `pnpm` on `win32`.
- Commits carry `(PMK-208)` and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `npm test` exits 0 before the PR.

## Review Focus

- A Yarn Berry repository (`yarn.lock` with `__metadata`): `yarn audit` prints no `auditSummary`; expect a scanner error, never `no alerts`. Test in Task 2.
- A saved report written by PowerShell (UTF-16 LE with BOM) or with CRLF: expect it to parse. Test in Task 5.
- A pip-audit dependency with `skip_reason`: expect a warning and `incomplete`, never a clean list. Test in Task 3.
- `--report` for a scanner whose lockfile the repo lacks: expect it read anyway. Test in Task 5.
- An empty stdout from `cargo audit` with `no such command` on stderr: expect an error that carries stderr. Test in Task 4.

---

### Task 1: Shared run helper and the `unknown` severity

**Files:** Modify `scripts/lib/alerts.mjs`; Test `scripts/alerts.test.mjs`, `scripts/alerts-scan.test.mjs`

**Interfaces:**
- Produces: `runScanner(command, args, { root, env, timeoutMs, platform, spawn, shim, label }) -> { stdout, stderr }` (throws the npm-style messages with `label` in place of `npm audit` and `command` name in "is not installed"); `shimCommand(name, platform)` (`npmCommand` stays as `shimCommand('npm', platform)`); `SEVERITIES` with `unknown`; `priorityFor('unknown', ...) === null`; `emptyOutputError(label, stderr)`.

- [ ] Tests: `priorityFor('unknown', ['urgent','high','medium','low']) === null`; `SEVERITIES.at(-1) === 'unknown'`; the existing npm tests still pass unchanged.
- [ ] Run `node --test scripts/alerts.test.mjs scripts/alerts-scan.test.mjs scripts/cli-alerts.test.mjs`, expect the new tests to fail.
- [ ] Move the npm spawn and its error mapping into `runScanner`; `priorityFor` returns `null` for `unknown`; `rank` sorts `unknown` last.
- [ ] Run the same tests, expect PASS. Commit `refactor(alerts): share the scanner run and add the unknown severity (PMK-208)`.

### Task 2: yarn and pnpm

**Files:** Modify `scripts/lib/alerts.mjs`; Test `scripts/alerts.test.mjs`

**Interfaces:**
- Produces: `groupAdvisories(scanner, entries) -> { alerts, warnings }` where each entry is `{ package, severity (npm name), title, url, fixAvailable }`; `parseYarnAudit(stdout, stderr)`, `parsePnpmAudit(stdout, stderr)`, each `-> { alerts, warnings }`, throwing on unreadable output.

- [ ] Tests: two yarn `auditAdvisory` lines for the same `module_name` (`moderate` and `high`) give one alert `yarn-audit:<name>` with severity `high`, the title of the `high` advisory and two `advisories`; a yarn `{"type":"error","data":"x"}` line throws `yarn audit failed: x`; output with no `auditSummary` and no advisory throws `yarn audit printed no audit report`; a pnpm `advisories` object gives the grouped alerts; pnpm `{ error: { code, message } }` throws `pnpm audit failed (<code>): <message>`; `patched_versions: '<0.0.0'` is `fixAvailable: false`; CRLF NDJSON parses.
- [ ] Run, expect FAIL. Implement; register both in `SCANNERS` (`yarn.lock`, `pnpm-lock.yaml`; `yarn audit --json`, `pnpm audit --json`, shim on win32).
- [ ] Run, expect PASS. Commit `feat(alerts): read yarn audit and pnpm audit (PMK-208)`.

### Task 3: pip-audit

**Files:** Modify `scripts/lib/alerts.mjs`; Test `scripts/alerts.test.mjs`

**Interfaces:** Produces `parsePipAudit(stdout, stderr) -> { alerts, warnings, incomplete? }`.

- [ ] Tests: `{ dependencies: [{ name: 'django', version: '3.2', vulns: [{ id: 'PYSEC-2023-1', aliases: ['CVE-2023-0001'], fix_versions: ['3.2.1'] }] }, { name: 'ok', vulns: [] }] }` gives one alert `pip-audit:django`, severity `unknown`, title `PYSEC-2023-1 (CVE-2023-0001)`, URL `https://osv.dev/vulnerability/PYSEC-2023-1`, `fixAvailable: true`; the old top-level array form parses the same; a dependency with `skip_reason` adds a warning naming it and `collectAlerts` marks the scanner entry with `error`-free `incomplete: true` and the result `incomplete`; non-JSON throws.
- [ ] Run, expect FAIL. Implement; register (`requirements.txt`; `pip-audit -r requirements.txt -f json --progress-spinner off`; never the shell). `collectAlerts` copies a parser's `incomplete` into the scanner entry; the CLI's `incomplete` counts it.
- [ ] Run, expect PASS. Commit `feat(alerts): read pip-audit (PMK-208)`.

### Task 4: cargo audit and CVSS 3

**Files:** Modify `scripts/lib/alerts.mjs`; Test `scripts/alerts.test.mjs`

**Interfaces:** Produces `cvssSeverity(vector) -> 'critical'|'high'|'medium'|'low'|'unknown'`, `parseCargoAudit(stdout, stderr)`.

- [ ] Tests: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` is critical (9.8); `.../C:N/I:N/A:H` high (7.5); `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N` medium (5.3); `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N` low (3.7); `CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H` critical (9.9); `null` and `CVSS:4.0/...` unknown. Two list entries for the same `advisory.package` give one alert; empty stdout with stderr `error: no such command: audit` throws a message carrying it; `{ vulnerabilities: { list: [] } }` gives no alert.
- [ ] Run, expect FAIL. Implement the CVSS 3.x base score with the spec's roundup; register (`Cargo.lock`; `cargo audit --json`).
- [ ] Run, expect PASS. Commit `feat(alerts): read cargo audit (PMK-208)`.

### Task 5: Saved reports

**Files:** Modify `scripts/lib/alerts.mjs`, `scripts/pmkit.mjs` (`alerts list`, `alerts scan`); Test `scripts/alerts.test.mjs`, `scripts/cli-alerts.test.mjs`, `scripts/cli-alerts-scan.test.mjs`

**Interfaces:**
- Produces: `readReport(file) -> string` (BOM, UTF-16 LE, CRLF); `collectAlerts(root, { reports })` where `reports` is a `Map<scannerId, absolutePath>`; scanner `parse(stdout, stderr)` on every entry; `parseReports(ctx) -> Map` in `pmkit.mjs`.

- [ ] Tests: `alerts list --report npm-audit=<file>` with no lockfile and an empty `PATH` reads the file (entry `{ id, detected: true, alerts, report }`); with a `package-lock.json` and a `pnpm-lock.yaml` and only an npm report, pnpm is `skipped: true`, a warning names it and `incomplete` is false; `--report bogus=x`, `--report npm-audit`, the same scanner twice and a missing file are `INVALID_INPUT`; a file with bad JSON is a warning and `incomplete: true`; a UTF-16 LE file with BOM and a CRLF yarn file parse; `alerts scan --report` gives candidates.
- [ ] Run, expect FAIL. Implement; add `report` to `flags` and usage of both commands.
- [ ] Run, expect PASS. Commit `feat(alerts): read saved scanner reports (PMK-208)`.

### Task 6: Docs, goldens, changelog

**Files:** `README.md`, `commands/issues/security-alerts.md`, `CHANGELOG.md`, `scripts/__goldens__/*/alerts-*.txt` (regenerated), and any help golden that holds the usage line.

- [ ] Update the README rows, the security-alerts command (a `report` parameter passed through to `alerts scan`, the scanner list, `unknown` in the severity table and a null priority in step 2, Known limits), one CHANGELOG line at the top of `## Unreleased`.
- [ ] `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, review the diff, then `npm test` in the foreground: exit code 0.
- [ ] Commit `docs(alerts): document the new scanners and --report (PMK-208)`.
