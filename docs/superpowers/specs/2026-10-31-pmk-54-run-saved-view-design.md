# PMK-54 run-saved-view command design

## Intent

`/pmkit:issues:run-view [name]` runs a saved view by name and shows the issue table from the conventions. The CLI already has `views run` (PMK-44), so the command is a markdown file that calls it and handles each failure.

## Goals

- Run a view by name, or list the views and ask when no name is given.
- Show the table (ID, title, status, assignee, estimate), the count and every warning of the CLI.
- Cover a missing view (suggest `views list`), an out of date view (`INVALID_INPUT` with "out of date"), a broken view file and a tracker without `saved_views` (Linear).

## Non-goals

- No CLI change and no change to the view format. `issues bulk --view` (PMK-56) keeps working.
- The command never writes. Repairing a view (`views save --overwrite`) is shown, not run.

## Decisions (my calls)

- The file is `commands/issues/run-view.md`, next to `find.md` and `bulk.md`.
- Step 1 reads `capabilities` first, so Linear gets a clear answer and an offer of `issues list` with the same filter.
- A scenario `issues-run-view` runs the view `in-progress` on the `team` fixture, with the view file added by `setup`.
