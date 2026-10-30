# PMK-44 saved views for the Local tracker

Source: Local adapter, Entity mapping (`views/<name>.yaml` with a query); MVP skills, query ("offers to save as a view when the same query repeats"); Unified model, `run_saved_view`.

## Goal

A user saves an issue filter under a name and runs it later. The `saved_views` capability becomes native on the Local tracker.

## Non-goals

- Deleting or renaming a view. Neither is in the acceptance criteria. Both are follow-ups.
- Views on Linear. Linear has saved views, but the adapter does not serve them, so the manifest lists the three operations as unsupported.
- Overriding a stored filter at run time.

## Design

### File

`.issues/views/<name>.yaml` holds one key, `filter`, with the keys that `searchIssues` accepts (`categories`, `types`, `assignee`, `labels`, `sprint`, `parent`, `blocked`, `updatedBefore`, `updatedAfter`, `archived`, `sort`, `limit`, `text`, `release`). Values such as `sprint: current` and `assignee: me` stay symbolic, so a view keeps meaning the current sprint or the current user. The file name is the view name. A name uses the same character rule as a release id and cannot differ from another name only by case.

```yaml
filter:
  categories: [in_progress, in_review]
  assignee: me
  sort: priority
```

### Contract operations

Three new operations in `TRACKER_OPERATIONS`:

- `saveView(name, filter, actor, { dryRun, replace })` returns `{ before, after }` with `{ name, filter }`. It refuses an empty filter, an invalid filter (the same checks as `searchIssues`) and an existing name (`CONFLICT`) unless `replace` is true.
- `listViews()` returns `[{ name, filter }]` sorted by name.
- `runView(name)` returns what `searchIssues` returns for the stored filter. A missing view is `NOT_FOUND`. A file that does not parse is `INVALID_INPUT` with a next step of `/pmkit:local:doctor`.

The Linear adapter gets the generic stubs, which answer `NOT_SUPPORTED`. The Linear manifest lists `saveView`, `listViews` and `runView` under `saved_views.detail.unsupported`.

### CLI

- `views save <name> [filter flags] [--replace]` (a write). The filter flags are the ones of `issues list`, with the same parsing.
- `views list` prints a table with name and filter, or `no views`.
- `views run <name>` prints the issue table like `issues list`, with the same warnings.

### Capability

`SERVED_BY.saved_views = ['views list', 'views save', 'views run']`, so the Local manifest reports `saved_views` as native.

### Skill

`commands/issues/find.md` step 7 offers to save a repeated question as a view with `views save`, and says to run it with `views run`.

## Decisions taken without the user

- File layout (`filter:` key) and the name rule.
- `--replace` instead of a silent overwrite.
- No delete command in this issue.
