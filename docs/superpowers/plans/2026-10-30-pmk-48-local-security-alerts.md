# PMK-48 Local security alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `alerts list` reads the output of the scanners the repository has and returns alerts with a severity.

**Architecture:** `scripts/lib/alerts.mjs` holds a scanner registry (`npm-audit` only), the severity map and the parser. A read-only CLI command `alerts list` calls it and never touches the tracker. `security_alerts` becomes a derived capability.

**Tech Stack:** Node ESM, `node:test`, `node:child_process`.

**Spec:** `docs/superpowers/specs/2026-10-30-pmk-48-local-security-alerts-design.md`

## Global Constraints

- Severities are exactly `critical`, `high`, `medium`, `low`. npm `moderate` is `medium`, `info` is `low`.
- Alert id is `<scanner>:<package>`.
- Changes to `scripts/lib/capabilities.mjs` and `scripts/__goldens__/*/capabilities.txt` stay minimal (PMK-49 to PMK-51 edit them too).
- Tests never reach the network: a fake `npm` goes first on `PATH`.

## Review Focus

- `npm audit` exits 1 with valid JSON: alerts still show (CLI test).
- `npm` missing or printing garbage: a warning, exit 0 (CLI test).
- No `package-lock.json`: the "no scanners found" line (CLI test).
- `--severity bogus`: `INVALID_INPUT` (CLI test).
- An advisory-less `via` (only package names): title falls back to `vulnerable through <names>` (unit test).

---

### Task 1: Scanner library

**Files:**
- Create: `scripts/lib/alerts.mjs`
- Test: `scripts/alerts.test.mjs`

**Interfaces:**
- Produces: `SEVERITIES` (`['critical','high','medium','low']`), `parseNpmAudit(stdout: string): { alerts, warnings }`, `collectAlerts(root, { env }): { scanners, alerts, warnings }`.

- [ ] **Step 1: Write failing unit tests** for `parseNpmAudit`: moderate maps to medium, info to low, an unknown severity maps to low with a warning, title from the first advisory object in `via`, fallback title `vulnerable through a, b`, `fixAvailable` coerced to boolean, invalid JSON and missing `vulnerabilities` throw an `Error`.
- [ ] **Step 2: Run** `node --test scripts/alerts.test.mjs`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `alerts.mjs`. `collectAlerts` detects `package-lock.json`, runs `npm audit --json` with `spawnSync` (cwd root, env), parses stdout whatever the exit code, turns a spawn error or parse error into `scanner.error` plus a warning, and sorts alerts by severity then package.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(alerts): read npm audit output as alerts (PMK-48)`.

### Task 2: The `alerts list` command and the manifest

**Files:**
- Modify: `scripts/pmkit.mjs` (new COMMANDS entry after `risks`), `scripts/lib/capabilities.mjs`, `scripts/golden-cases.mjs` (`'alerts list': () => [[]]`), `scripts/capabilities.test.mjs`
- Create: `scripts/cli-alerts.test.mjs`
- Regenerate: `scripts/__goldens__/*/alerts-list.txt`, `*/capabilities.txt`

**Interfaces:**
- Consumes: `collectAlerts`, `SEVERITIES` from Task 1.

- [ ] **Step 1: Write failing CLI tests** in `cli-alerts.test.mjs` with a fake `npm` script on `PATH`: alerts found with npm exit 1; no lockfile; npm failing; `--severity high` filter; `--severity bogus` is `INVALID_INPUT`. Update `capabilities.test.mjs`: `security_alerts` moves from absent to derived with detail `{ source: 'scanners' }`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the command (`flags: ['severity']`, text table `ID, Severity, Package, Title`, warnings via `warnings`), set `SERVED_BY.security_alerts = ['alerts list']` and `derived.security_alerts = { detail: { source: 'scanners' } }`.
- [ ] **Step 4: Regenerate goldens** with `UPDATE_GOLDENS=1 node --test scripts/goldens.test.mjs`, read `git diff scripts/__goldens__`, then run `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(alerts): add alerts list and serve security_alerts (PMK-48)`.
