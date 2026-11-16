# PMK-234: guard the prioritize-by-demand write

Follow-up of PMK-68. Only `commands/backlog/prioritize-by-demand.md` changes in behavior, plus its scenario, docs and the scenario counts. No CLI change.

## Brainstorm notes

The brainstorming ran without a person to answer (an Orca worker), so the open points are my calls, listed at the end.

- `issues bulk --expect` already exists: it freezes one change and one filter in a digest and refuses the write when the set changed. prioritize-by-demand writes a different priority per issue (`issues update <id> --priority <p>`), and `issues bulk` has no ID filter, so it cannot apply it. The guard borrows the idea (freeze the preview, check before writing) without the command.
- The window to guard is step 6 (dry runs) and step 7 (the user reads the preview and answers) to step 8 (the writes). An issue edited in that window (priority changed by someone else, moved, re-estimated) would be overwritten by a proposal made from the old state.

## Design

### 1. Stale-write guard (AC 1)

- Step 6 keeps, for each accepted issue, the `before` of its dry run (it includes `updated`).
- New first part of step 8, before any write: run the step 6 dry runs again and compare each `before` with the one the user saw. When any differs, or any dry run fails, write nothing. Show each issue that changed (`priority`, `status` or `updated`: previewed → now) and say the preview is out of date. Go back to step 2: new ranking, new proposals, new confirmation. The old confirmation is not reused.
- A failed re-check is "not verified", never "unchanged". The command does not write from it.
- When every `before` is the same, step 8 writes one at a time as before. A write that fails still stops the batch and lists applied and remaining.
- Residual window: between the re-check and each write is not closed, because the CLI has no compare-and-set on `issues update`. Said in the command file as the known ceiling.

### 2. Ranking-only mode (AC 2)

- New first argument `rank-only` (a bare word, not a flag, because the CLI has no such flag and the scenario rule 3 would reject a loose flag). The rest are the find flags, as now. `argument-hint` becomes `[rank-only] [find flags]`.
- With `rank-only` the command runs steps 1 to 4 and the ranking of step 5, then stops. It proposes nothing: no proposed priority, no cap, no bands, no question. The table has rank, ID, title, score with its parts, current priority and the signal. Not verified and not ranked issues, warnings and incomplete-read notes are shown as now. Steps 6 to 9 do not run and no write call is made.
- The output says "ranking only: nothing proposed, nothing written".

## Non-goals

A CLI compare-and-set for `issues update`; an ID filter for `issues bulk`; weighting by revenue (PMK-241, PMK-242 cover the rest of PMK-68).

## My calls (not confirmed by anyone)

1. The guard is in the command file, not in a new CLI flag.
2. `rank-only` is a keyword, not `--rank-only`.
3. A stale preview restarts at step 2 instead of re-dry-running only the changed issues, because the ranking can change.
