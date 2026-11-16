# PMK-180: saved views with invalid file names and the Linear hint

Size: a small change (four independent defects of PMK-44). Choices below are the implementer's call; the issue gave the scope and the acceptance criteria.

## Decisions

1. `listViews` (`scripts/lib/local/tracker.mjs`) reports a `.yaml` file whose stem breaks the view-name rule as a problem `{ id: <stem>, code: 'INVALID_INPUT', message }`, with the same message `validate` gives (`view name "x" must start and end with ...`). It no longer drops it silently.
2. `views list --json` returns `{ views, problems }` (the shape of `customers list` and `requests list`) instead of a bare array, so the problems are in the JSON. The text output and the `warnings` on stderr stay. `views list` is the only consumer of the bare array: `commands/issues/run-view.md` ("the entry with this name") is updated to read `views`, and the goldens change.
3. `commands/local/doctor.md`: the `views save ... --overwrite` exception applies only to a view problem about the file content (does not parse, needs a filter, out of date filter). A view problem about the name is a rename by the user, like the other `view`-adjacent id problems, because `saveView` refuses an invalid name.
4. `scripts/lib/linear/manifest.mjs`: the `saved_views` hint becomes `The Linear adapter does not serve views yet; Linear offers them on this workspace`, the wording of the neighbours. The generic `unservedHint` at the bottom (capabilities with a non-empty `SERVED_BY` that Linear cannot serve) keeps its wording.
5. `filterText` (`scripts/pmkit.mjs`) quotes a value with whitespace, `=`, `"` or `,` using `JSON.stringify`, per element, so `labels: ['a b', 'c']` prints `label="a b",c`.

## Out of scope

`docs/superpowers/epc-6-follow-ups.md` improvements. No change to the view file format.
