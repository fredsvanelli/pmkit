# PMK-208 design: more scanners and saved reports for alerts list

Issue PMK-208, a follow-up of PMK-48 (EPC-6). Status: approved by the author's own choice (autonomous run, no questions asked). Every decision below is my call unless it says otherwise.

## Problem

`alerts list` and `alerts scan` read only `npm audit`, and only by running it, so the scan needs the network. The acceptance criteria:

1. Read other scanners: `pip-audit`, `cargo audit`, `yarn audit` and `pnpm audit`.
2. Read a saved scanner report, so the command works offline.

## Goals

- Four more entries in the `SCANNERS` registry of `scripts/lib/alerts.mjs`, each with a detection, a run and a parser. Both commands get them, because both call `collectAlerts`.
- `--report <scanner>=<file>` on `alerts list` and `alerts scan`. With it, the CLI reads the file instead of running the scanner. `/pmkit:issues:security-alerts` takes the same report, so the command works offline.

## Non-goals

- Yarn Berry (`yarn npm audit`), `pip-audit` on a `pyproject.toml` or the current environment, CVSS 4.0 vectors. They are follow-ups.
- Changing how `npm audit` maps an unknown severity (still `low` with a warning).
- The PMK-230 items (fold transitive advisories, close fixed alerts, a scenario with a fake npm).

## Decisions

### Scanners

| ID | Detection (repo root) | Run | Output read |
|---|---|---|---|
| `npm-audit` | `package-lock.json` or `npm-shrinkwrap.json` | `npm audit --json` | unchanged |
| `yarn-audit` | `yarn.lock` | `yarn audit --json` | Yarn classic NDJSON: `auditAdvisory` lines (`data.advisory`), `error` lines |
| `pnpm-audit` | `pnpm-lock.yaml` | `pnpm audit --json` | npm v6 style `{ advisories: { <id>: advisory } }`, or `{ error }` |
| `pip-audit` | `requirements.txt` | `pip-audit -r requirements.txt -f json --progress-spinner off` | `{ dependencies: [{ name, vulns: [{ id, aliases, fix_versions }] }] }`, or the older top-level array |
| `cargo-audit` | `Cargo.lock` | `cargo audit --json` | `{ vulnerabilities: { list: [{ advisory: { id, package, title, url, cvss }, versions: { patched } }] } }` |

- Every scanner exits non-zero when it finds vulnerabilities, so stdout counts whatever the exit code is, as for npm.
- The run shares one helper with npm: the 256 MiB buffer, the 60 s timeout (5 minutes for pip-audit and cargo audit, which build a virtual environment or fetch their database), and the same messages for a missing executable, a timeout and an overflow. `yarn` and `pnpm` are `.cmd` shims on Windows, so they run through the shell like npm, with the same missing-shim check. `pip-audit` and `cargo` are executables and never use the shell.
- `cargo audit` with no `cargo-audit` installed prints `no such command` on stderr and nothing on stdout: an empty stdout is an error that carries stderr, like npm.
- **One alert per package**, so the `alert-key:` of `alerts scan` (scanner and package) stays stable. Yarn, pnpm and cargo report one entry per advisory: the parser groups them by package. The alert severity is the highest of its advisories, and the title and URL come from the advisory with that severity, the first on a tie (the PMK-185 rule). `advisories` keeps every advisory.
- Alert IDs are `<scanner>:<package>`, as before.
- `fixAvailable`: yarn and pnpm, a `patched_versions` that is not `<0.0.0`; pip-audit, a non-empty `fix_versions`; cargo, a non-empty `versions.patched`.
- pip-audit has no advisory URL; the URL is `https://osv.dev/vulnerability/<id>`, because the PyPI advisory IDs and their aliases are all in OSV. The title is the advisory ID with its aliases, for example `PYSEC-2023-1 (CVE-2023-0001)`, since pip-audit gives only a long description.
- A pip-audit dependency with `skip_reason` was not audited: it adds a warning that names it, and the scanner entry is marked `incomplete`, because an unaudited package can hide an alert.

### Severity `unknown`

pip-audit gives no severity, and a RustSec advisory often has no CVSS vector. The rule of the project is that a state the command cannot know never becomes a value (`lessons.md`, round 3). So `SEVERITIES` gains `unknown`, last:

- pip-audit alerts are always `unknown`.
- cargo alerts take the severity of the CVSS 3.x base score of `advisory.cvss` (0.1 to 3.9 low, 4.0 to 6.9 medium, 7.0 to 8.9 high, 9.0 to 10 critical, 0.0 low). No vector, or a vector that is not CVSS 3, is `unknown`.
- A package with several advisories takes the highest severity, but an `unknown` advisory could be any severity, so it makes the package `unknown` unless another advisory is `critical` (changed after the review of PR #176). Advisories are deduplicated by their ID.
- yarn and pnpm use the npm names (`moderate` is `medium`, `info` is `low`). An unknown name is `low` with a warning, as for npm.
- `--severity` accepts `unknown`. `unknown` sorts after `low`.
- `priorityFor('unknown')` is `null`. Step 2 of `/pmkit:issues:security-alerts` already asks for a value when a candidate has a `null` priority, so an alert of unknown severity never gets a priority made up for it.

### Saved reports

- `--report <scanner>=<file>`, repeatable, one scanner per flag. Commas are not split, so a path can hold one. The file is the scanner's `--json` output saved, for example `npm audit --json > npm-audit.json`. A relative path resolves from the current directory.
- With at least one `--report`, nothing is run: the CLI reads only the given files. A detected scanner without a report is listed with `skipped: true`, and it makes the result `incomplete` like a failed scanner, with the line `incomplete: pnpm-audit was not read because --report was given without it (pass --report pnpm-audit=<file>), ...` (changed after the review of PR #176: an unread scanner never becomes `no alerts`).
- A reported scanner counts as detected, whatever lockfile the repository has, and its entry carries `report: <path>`.
- An unknown scanner ID, a missing `=`, a scanner given twice or an unreadable file is `INVALID_INPUT`, before any work. A file whose content does not parse is a scanner error, like a bad stdout: a warning, `incomplete: true`.
- The file text drops a UTF-8 BOM and is decoded as UTF-16 LE when it starts with `FF FE`, because Windows PowerShell 5 writes `>` redirections that way. CRLF is normalized.

### Output

The data shape stays `{ incomplete, scanners, alerts }` and `alerts scan` keeps its own. Scanner entries may add `report` and `skipped`. The text "no scanners found" line lists the five scanners and the files each needs, so the goldens change.

## Docs

- `README.md`: the `alerts list` and `alerts scan` rows name the scanners, `unknown`, and `--report`.
- `commands/issues/security-alerts.md`: a `report` parameter passed to `alerts scan`, the scanner list in step 1, `unknown` in the severity table, the Known limits line.
- `CHANGELOG.md`: one line under `## Unreleased`.
- `SERVED_BY` and the manifests do not change: the capability is still derived from scanners.

## Testing

- Unit tests per parser on canned output, the grouping, the CVSS 3 bands, the BOM and UTF-16 decoding, `priorityFor('unknown')`.
- CLI tests with a fake executable on `PATH` for one new scanner (the run path is shared), and `--report` for every scanner, including the skipped and invalid cases.
- Goldens regenerated for the new "no scanners found" text.
