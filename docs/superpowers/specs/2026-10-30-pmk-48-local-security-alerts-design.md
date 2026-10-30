# PMK-48 design: turn local scanner output into security alerts

Issue PMK-48, epic EPC-6. Status: approved by the author's own choice (autonomous brainstorm). PMK-73 (`security-alerts` command) is blocked by this issue and consumes its output.

## Problem

The `security_alerts` capability is absent in the Local tracker, because no command serves it. The source says it comes from "output of local scanners the repo already has (e.g., `npm audit`), turned into issues", through the Unified model operation `list_alerts`. The acceptance criteria:

- `list_alerts` reads the output of the scanners the repository has.
- An alert maps to a severity.

## Approaches

1. **A new CLI command `alerts list` backed by `scripts/lib/alerts.mjs`.** A scanner registry detects each scanner from files in the repository, runs it, and parses its JSON into alerts. The command is read-only and does not touch the tracker.
2. **A tracker operation `listAlerts` on the contract.** This adds an operation every adapter must implement, and Linear has no alerts. The alerts come from the repository, not the tracker, so the contract is the wrong place.
3. **Read a report file the user commits (for example `audit.json`).** It needs a convention nobody has defined, and the report goes stale.

Chosen: approach 1. It mirrors `risks` and `pr status`, which read the repository and the git host and not the tracker.

## Design

### Scanners (my call)

One scanner ships now: `npm-audit`. The registry is an array, so a later scanner is one more entry.

- Detection: `package-lock.json` exists at the repository root.
- Run: `npm audit --json` in the root. npm exits 1 when it finds vulnerabilities, so the parser reads stdout whatever the exit code is. A missing `npm`, an empty stdout, or JSON without a `vulnerabilities` object is a scanner error, reported as a warning. It never fails the command.
- Parse: npm audit v2 output. One alert per entry of `vulnerabilities`. `title` is the title of the first advisory in `via` (an object entry), else `vulnerable through <names of via>`. `url` is that advisory's URL, if any. `fixAvailable` is a boolean (`false`, or `true`/object from npm becomes `true`).

### Severity (my call)

Alerts carry one of `critical`, `high`, `medium`, `low`. npm's `moderate` maps to `medium`, `info` maps to `low`. An unrecognized value maps to `low` and adds a warning. Alerts sort by severity (critical first), then package name. PMK-73 maps severity to issue priority later.

### Command

`alerts list [--severity critical,high,...]` reads only. Data: `{ scanners: [{ id, detected, alerts, error? }], alerts: [{ id, scanner, package, title, severity, url, fixAvailable }] }`. Alert `id` is `<scanner>:<package>`. Text is a table (ID, severity, package, title) or one of these lines: `no scanners found in this repository (looked for: npm-audit needs package-lock.json)` and `no alerts`. `--severity` keeps only the listed severities and rejects other values with `INVALID_INPUT`.

The command is exempt from nothing: it needs `.pmkit/config.yaml` like the other commands, but never calls the tracker, so it gives the same output on every tracker.

### Capability manifest

`SERVED_BY.security_alerts` becomes `['alerts list']`. The entry is `derived` with `detail: { source: 'scanners' }`. This is the only change in `capabilities.mjs` and the golden `capabilities.txt` files, to keep the rebase small.

### Testing

Tests put a fake `npm` first on `PATH` (the pattern of `fake-gh.mjs`) so no test reaches the network. Unit tests cover the parser and the severity map. CLI tests cover no scanner, alerts found with exit 1 from npm, a failing scanner, and `--severity`. The golden case runs on fixtures without a lockfile, so it records the no-scanner output.

### Non-goals

Creating issues from alerts (PMK-73), GitHub Dependabot alerts (PMK-49 to PMK-51 cover other host data), scanners other than npm audit.
