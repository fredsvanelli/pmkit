# PMK-185: alerts list note, advisory titles and the missing-npm check

Follow-up of PMK-48 (PR #81) and PMK-175 (PR #94). Size: a small change, so this is the whole design. No question was open: the issue gives each criterion, and the choices below are my calls.

## Goals

1. `alerts list` prints the `note:` of the derived path of `security_alerts`, as rule 4 of the conventions asks. `alerts scan` already does.
2. The title and URL of an alert come from the advisory that has the alert's severity.
3. The warning for an empty `npm audit` stdout includes npm's stderr.
4. A valid `npm audit` report is never read as a missing npm.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`.

## Decisions (my calls)

- **Note.** `alerts list` becomes async and returns `notes` from `capabilityNotes(tracker, 'security_alerts')`, the same call `alerts scan` makes. The manifest is static, but a tracker that cannot load costs the note, not the command (the pattern of `linkedCodeNotes`), because `alerts list` never needed the tracker. The note is in `notes`, so the JSON and the text both carry it.
- **Advisory choice.** Each advisory severity maps through `NPM_SEVERITY`. The alert takes the first advisory whose mapped severity equals the alert's. With none equal (the package severity came from a dependency chain), it takes the most severe advisory, the first on a tie. `advisories` keeps every advisory as before.
- **Empty stdout.** `parseNpmAudit(stdout, stderr)` appends `: <stderr>` (whitespace collapsed, cut at 300 characters) to `npm audit printed empty output` when stderr has text. The runner passes `result.stderr`.
- **Missing npm.** `isNpmMissingOnShell` additionally requires a blank stdout, for exit 9009 too. A report on stdout is an audit that ran, so its exit code and its stderr say nothing about npm being absent.
