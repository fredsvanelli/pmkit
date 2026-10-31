---
description: Turn the security alerts of the repository scanners into issues with a priority from the severity, after a full preview
argument-hint: "[severity]"
disable-model-invocation: true
---

# Turn security alerts into issues

Arguments: `$ARGUMENTS`

## Parameters

- `severity` (optional): a comma-separated list of `critical`, `high`, `medium` and `low`. Only the alerts of those severities are scanned. Without it, every severity is scanned.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Scan the repository. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" alerts scan [--severity <severity>] --json`. The CLI runs the scanners the repository has (`npm audit` when there is a `package-lock.json` or `npm-shrinkwrap.json`), reads every issue of the tracker and drops the alerts an issue already holds, whatever that issue's status. A match is the `alert-key:` line of an issue this command created. Read the result in this order.
   1. When `absent` is `true`, no scanner is in this repository, so the `security_alerts` capability is absent. Say that, say what is missing (the CLI text names it, for example a `package-lock.json` for `npm audit`), and stop. Create nothing.
   2. When `incomplete` is `true`, the scan is not trustworthy. Either a scanner failed (the scanner entry has `error`), or the CLI did not read every issue, so an alert that an issue covers may look new and the command would create a duplicate. Show the warnings, which name the next step (`/pmkit:local:doctor` on the Local tracker), and stop before any create.
   3. When `candidates` is empty, show the `matched` list, say there is nothing to create and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types and priorities, when a candidate has a `null` `type` or `priority`. Ask for a value for those candidates.
3. Draft one issue per candidate. The title, type, priority and description are the candidate's own, because its `alert-key:` line is what keeps a second run from creating the issue again. Write each description to a temporary file outside `.issues/`.
4. Run the dry run of each issue: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --priority <priority> --description-file <file> --dry-run --json`. When a dry run fails, show the error and ask for a corrected value.
5. Show the full preview. First the `matched` packages as information (issue, status, severity, package, current advisories), and say when a match is `done` or `canceled`, because its package is still in the audit. A new advisory on a matched package does not open an issue. Then the candidates as a table (key, severity, priority, package, title). This is a bulk create, so it always shows the full list and asks, whatever `write_policy.confirm` says. Ask with `AskUserQuestion` whether to create all of them. Let the user drop rows, change priorities and titles, or move a `matched` row back to the creation list, which is the case when the match is wrong. A moved row keeps its `alert-key:` line. Then show the list again, running the dry run again for each changed or moved row. When the user declines, stop and create nothing.
6. After the approval of step 5, create the issues in table order. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --priority <priority> --description-file <file> --json` and note the new ID. When one fails, stop, list what was created and what was not, and do not retry it.
7. Remove the temporary files.

## Severity and priority

The CLI maps the severity of an alert to a tracker priority. It matches the name first, in the `priorities` list of the tracker (`pmkit discover`):

| Severity | Priority |
|---|---|
| critical | `urgent`, or `critical` when there is no `urgent` |
| high | `high` |
| medium | `medium`, or `normal` |
| low | `low` |

When the list has no such name, the position decides: `critical` is the first priority, `high` the second, `medium` the third and `low` the last, and a list with fewer than four entries uses its last entry for the severities it has no position for. The priority `none` is never used. npm `moderate` is `medium`, and npm `info` is `low`.

## Alerts and issues

One issue is one vulnerable package. The `alert-key:` line is a hash of the scanner and the package name (`npm-audit:<package>`), and nothing else. The advisories of the package, their order, their titles and the packages they go through are not in it, because they change when a dependency is fixed and a changed key would open a second issue. A package with two advisories is one issue, and a package that already has an issue, open or closed, archived or not, gets no new one. A new advisory on a package that has an issue does not open another. The preview lists the package under `already in the tracker` with its current advisories, so the user decides whether to comment on the issue or reopen it by hand. The title of a package that only goes through another one reads `Security: <package>: vulnerable through <names>`. The severity is not in the key either, so a severity that changes in the report does not open a second issue.

## Confirmation points

- Step 2: a value for a candidate that has no type or priority.
- Step 4: a corrected value after a failed dry run.
- Step 5: the full list of issues to create, always asked because it creates more than one record. Declining creates nothing. Editing the list shows it again.

## Output

A table of the created issues (full ID, title, severity, priority), then the packages that already had an issue, with the issue ID, its status and the current advisories. Mention that running the command again creates nothing for these packages, because each issue holds its `alert-key:` line. Say that a fixed alert does not close its issue.

## Known limits

- `npm audit` is the only scanner.
- The title of a new issue and the URL come from the first advisory of the package, which may differ from the advisory that sets its severity (PMK-185). The key does not depend on it.
- An alert that disappears from the audit does not close or change its issue.

## If something is missing

- No scanner (`absent` is `true`): the capability is absent. Say what the repository lacks, such as a `package-lock.json`, and stop.
- A scanner failed (`incomplete` is `true`, for example `npm` is not on the PATH, the audit timed out or npm had no registry): show the warning and stop. Offer to run the command again after the fix.
- `--severity` has an unknown value: the CLI answers `INVALID_INPUT`. Ask for one of `critical`, `high`, `medium` or `low`.
- An error from the CLI: apply the rules for reading errors in the conventions.
