# PMK-67 design: the initiatives-and-goals command

Source: Unified model, PM catalog (`initiatives-and-goals`: "Progress of strategic goals via deliverable rollup"; degradation "Top-level hierarchy issues").

Written without a round of questions. The calls the builder made are under "Decisions".

## Goal

- `pmkit goals overview`, a read that gives each strategic goal with the progress of its epics, and falls back to top-level issues when there are no goals.
- `/pmkit:report:initiatives-and-goals`, the command file that shows it.

## Non-goals

- No new storage, no change to `goal *` or to the capability manifest (`strategic_goals` stays as PMK-45 left it, absent on Linear).
- No writes.

## CLI

`pmkit goals overview` returns `{ source, complete, items, withoutChildren, notes, warnings }`.

- `source` is `goals` when the tracker has at least one goal, otherwise `top_level`.
- With goals, each item is `{ goal, epics, total, done, canceled, points, pointsDone, progress }` from `goalProgress`. `progress` is `done / total`, or `null` when `total` is 0 (unknown, never 0%). A goal file that does not parse is a warning and makes `complete` false, and it is not "no goals": the fallback runs only when every goal file was read. An epic file that does not parse (it may link to a goal) and an issue file that does not parse are warnings too, because the goal's progress may be low.
- Without goals (none exist, or the tracker answers `NOT_SUPPORTED`, as Linear does for initiatives) the command reads the issues and takes the top-level ones: not archived, with no parent, or whose parent is not an issue of the read (an epic). Only those with sub-issues are listed; their progress rolls up all descendants (canceled issues leave the total). Issues in a parent cycle, under an archived parent (the read includes archived issues) or under a parent file that did not parse are listed in a warning and not counted. A broken epic file is not part of this answer and a file in `goals/` that is not a goal is only a note, so neither makes it incomplete or blocks it. `withoutChildren` counts the top-level issues left out. The `notes` and the text say `no goals: using top-level issues`, and say why when it is `NOT_SUPPORTED`.
- An incomplete issue read (`hasMore`, issue files that do not parse) is `complete: false` with a warning, and the progress is not a conclusion.

## Command file

Runs `goals overview --json`, shows the `notes`, the warnings, then one table: goal (or issue), progress, done/total, points. Says first which source it used. Nothing to confirm; it writes nothing.

## Decisions

- A new CLI read over prose in the command file, so Local and Linear compute the rollup in one place.
- Top-level issues with no sub-issues are counted, not listed.
- The command is not in `SERVED_BY`, so the manifest and the ADR counts do not change.
