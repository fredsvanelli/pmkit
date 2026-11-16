# PMK-271: hide every absolute path in the auto_commit failure message

Size: small change. The questions were skipped by the orchestrator's rule (no `AskUserQuestion`); the choices below are my calls.

## Problem

`commitIn` (scripts/pmkit.mjs) cleans git's stderr for the `UPSTREAM` message. After `relativeTo` removes the repository folder, a regex replaces other absolute paths with `<path>`, but it stops at the first whitespace (`/Users/John Doe/.gitconfig` becomes `<path> Doe/.gitconfig`) and does not know UNC paths (`\\host\share\x`). With more than 5 files outside the repository, `commitTracker` names them "the tracker files".

## Decisions

- New `hideAbsolutePaths(text)` in scripts/lib/paths.mjs, used by `commitIn`. An absolute path starts at `/`, `X:\` or `X:/`, or `\\` (UNC), after the start of a line, whitespace, `(` or a quote.
- Rule for spaces (my call, a path with a space is ambiguous in git's stderr): never show part of a path. A path inside quotes is hidden up to the matching quote (git quotes the paths it names). An unquoted path, or a quote that never closes, is hidden to the end of the line. This can hide text after the path, which is the safe side.
- Next step with more than 5 files outside the repository: `the tracker files in <tracker.path>`. `tracker.path` is relative for a folder next to the repository. An absolute `tracker.path` is never shown: the text stays "the tracker folder".

## Out of scope

Messages of commands other than auto_commit.
