# PMK-73 design: turn security alerts into issues

Issue PMK-73, epic EPC-6. Status: approved by the author's own choice (autonomous brainstorm). It consumes `alerts list` (PMK-48, Windows fix PMK-175) and follows `todos-to-issues` (PMK-64).

## Problem

`alerts list` returns the alerts of the scanners the repository has. Nothing turns them into issues. The acceptance criteria:

- The command turns security alerts into issues with a priority from the severity, after a full preview.
- Without security alerts it says the capability is absent.

## Design

### CLI: `alerts scan`

A read-only command, like `todos scan`. It runs the scanners of `alerts list`, reads every issue of the tracker and returns the alerts that no issue covers yet, each with a title, a type, a priority and a description. The agent does not compute anything.

Data: `{ absent, incomplete, scanners, unread, candidates, matched }`.

- `absent` is `true` when no scanner is detected. The text says the `security_alerts` capability is absent in this repository and what is missing (`npm-audit needs package-lock.json or npm-shrinkwrap.json`).
- `incomplete` is `true` when a scanner failed or the tracker read was cut (more issues than the read limit, or issue files that did not parse). The command creates nothing then. Its text and warnings say why.
- A candidate is `{ key, id, scanner, package, severity, priority, title, url, fixAvailable, description }`.
- A matched alert has the same fields plus `issue`, `status`.

### Key (my call)

One alert is one package of one scanner, with the advisory that `alerts list` shows for it. The key is the first 12 hex digits of the SHA-256 of `<scanner>\n<package>\n<advisory url, or the title when npm gives no URL>`. The description ends with the line `alert-key: <key>`. A second run finds that line in the issue body and creates nothing, whatever the status of the issue. A new advisory on the same package has a new URL, so it opens a new issue. The key does not hold the severity, so a severity that changes in the audit report does not duplicate the issue.

### Transitive advisories (my call)

One issue per alert, which means one per package. An advisory that npm reports for several packages (the package and the ones that depend on it) opens one issue for each, because each package has its own fix path and its own owner. The title of a package that only goes through another one is `<package>: vulnerable through <names>`. Folding them into one issue would need the `via` graph in `alerts list`, which PMK-185 touches, so it stays a follow-up.

### Severity to priority (my call)

The tracker priorities come from `.pmkit/config.yaml` (`priorities`, highest first, `urgent, high, medium, low` by default). The mapping is by position: `critical` is the first priority, `high` the second, `medium` the third and `low` the last one. A list with fewer than four entries clamps to its last entry (three priorities: `critical` and `high` get the first two, `medium` and `low` the third). A tracker with no `priorities` value never reaches this, since the config always has the default list.

### Type and description

The type is `bug` when the tracker allows it, else the first allowed type. The title is `Security: <package>: <advisory title>` cut at 120 characters. The description holds the advisory title, severity, package, the URL, whether npm reports a fix (`fixAvailable`), the scanner and the `alert-key:` line.

### Command: `/pmkit:issues:security-alerts`

Follows the steps of `/pmkit:issues:todos`: scan, stop on `absent` or `incomplete`, dry run every create, show the full preview (with the matched alerts as information), ask once, create in order, and on a failure stop and list what was created and what was not. It accepts an optional `severity` filter that is passed to the scan.

### Linear

The command reads the repository and the tracker's issues, so it works on both trackers. `security_alerts` stays derived on both and `SERVED_BY` does not change.

### Known limits

- `alerts list` shows one advisory per package (the first in `via`, PMK-185).
- Only npm audit is a scanner.
- Fixed alerts do not close their issues.

## Testing

Unit tests for the key and the priority mapping. CLI tests with the fake npm of `cli-alerts.test.mjs`: candidates and priorities, a second run that matches by key, a failed scanner (`incomplete`), no scanner (`absent`), an unreadable issue file (`incomplete`), custom priorities, `--severity`. A scenario for the command and plugin tests for the command text.
