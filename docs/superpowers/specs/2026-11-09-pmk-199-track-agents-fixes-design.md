# PMK-199: track-agents on a broken comment and transient errors

Source: PMK-199 (follow-up of PMK-58, PR #110). Scope is the four defects of the issue, all in `runTrackAgents` (`scripts/pmkit.mjs`) and `prText` (`scripts/lib/track-agents.mjs`).

## Decisions

1. **Broken comment.** The comment read in `runTrackAgents` also catches `FrontmatterError` (not a `PmkitError`). The row gets delegation `unknown`, a problem `{ code: 'INVALID_INPUT', message: 'the comments could not be read: ...' }`, the list is `incomplete`, and the loop goes on. `NOT_CONFIGURED`/`AUTH` still stop the command.
2. **Protection cache.** Only a successful read (a value or `null` for "not protected") is stored. A thrown error is not stored: it propagates and the next issue reads again. Cost: a persistent 403/404 repeats the call per issue; accepted, since `collectBlockers` already turns it into `unchecked`.
3. **Text.**
   - `blocked: true` appends what is not verified (`unknown` messages and `unchecked` areas) to the row text.
   - With no rows but `incomplete`, the text says no agent issue was *found* and that the list is incomplete, never "no open issue is assigned".
   - The text of an incomplete list ends with the warning line, so a reader of the table sees it.
4. **Warning names its causes.** The fixed incomplete warning is built from the causes that happened: issue files that did not parse, a cut issue read, comments not read, pull requests not read (GitHub named only then), merge state not ready. Cause fragments are listed only when they apply.

## Non-goals

The improvements in `docs/superpowers/epc-6-follow-ups.md`.
