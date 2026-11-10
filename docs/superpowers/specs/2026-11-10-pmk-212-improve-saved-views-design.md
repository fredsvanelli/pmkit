# PMK-212: Improve saved views

Follow-up of PMK-44 (saved views), from the EPC-6 reviews. None of the four items is a defect. Source: `docs/superpowers/epc-6-follow-ups.md`.

## Intent

Saved views exist on the Local tracker (`views save`, `views list`, `views run`, `.issues/views/<name>.yaml`), and on Linear the capability is `absent`. A user cannot remove or rename a view without touching the files by hand, `validate` misses two broken shapes, a view freezes its limit and order, and a Linear team cannot run the views it already has in Linear.

## Goals (one per acceptance criterion)

1. `views delete <name>` and `views rename <name> <new-name>` on the Local tracker.
2. `validate` reports two view files whose names differ only in case and a view whose `filter` is `{}`, and counts the views it checked in `checked.views`.
3. `views run <name> --limit n --sort s` overrides the stored limit and order for one run, without changing the view.
4. On Linear, `views list` and `views run` read the workspace's custom views through the API, so `saved_views` becomes `native` there.

## Non-goals

- Creating, renaming or deleting Linear views from pmkit. On Linear `saveView`, `deleteView` and `renameView` answer `NOT_SUPPORTED` and the manifest lists them in `detail.unsupported` (builder's call, see below).
- Overriding any key other than `limit` and `sort` in `views run`.
- Migrating Local views to Linear views. The migration keeps listing views as a loss.
- A new slash command. The new CLI subcommands are documented in the README and in the commands that offer them.

## Design

### Local: delete and rename (criterion 1)

- New contract operations `deleteView(name, actor, { dryRun })` and `renameView(name, newName, actor, { dryRun })`, next to `saveView`, `listViews`, `runView`.
- `deleteView` checks the name rule (`invalid_view_name`), answers `NOT_FOUND` for a missing file, and removes `.issues/views/<name>.yaml`. It returns `{ before, after: null }`. `before` is the view, or `{ name, unreadable }` when the file does not parse, so a broken view can be deleted and the result says what was lost. `--dry-run` writes nothing.
- `renameView` checks both names, answers `NOT_FOUND` when the old one is missing, and `CONFLICT` when another view has the new name in any case (a case-only rename is `INVALID_INPUT`: git does not record it where the file system ignores case, so the user renames through another name first; review of PR #179). It moves the file as is, so the stored filter does not change. It returns `{ before: { name, filter }, after: { name: newName, filter } }` (or `unreadable` in both when the file does not parse).
- The CLI: `views delete <name>` and `views rename <name> <new-name>`, both writes with `--dry-run`, both auto-committed like `views save`.

### validate (criterion 2)

- `checked` gains `views`, counted for every view file it reads (as releases are counted), and the text head line ends with `N views`.
- A view whose `filter` is an empty map is a problem: `view filter is empty, so the view matches every issue`.
- Two view files whose stems are equal ignoring case are a problem on each later file: `view name "Mine" differs from "mine" only in case`. On a case-insensitive file system those are one file; on Linux, `views save` already refuses such a clash.

### views run overrides (criterion 3)

- `views run <name> [--limit n] [--sort s]`. The values replace the stored `limit` and `sort` for this run only; nothing is written.
- The overrides are checked before the stored filter runs, so a bad `--sort` is `INVALID_INPUT` about the flag, never `view_out_of_date`.
- The JSON result keeps `view` (the stored filter) and adds `overrides` with the values used. The hasMore note and the order note use the effective sort.

### Linear saved views (criterion 4)

- `listViews` reads `customViews` (paginated, the client's 10-page cap) and keeps the issue views (`modelName` `Issue`) of the scope team plus the workspace views that have no team. Each view is `{ name, id, filter: null, linear: { team, shared, filterData } }`: Linear stores its own filter, which pmkit does not translate back into flags. A cut read sets `hasMore: true` and a warning, so the list is never presented as complete.
- `runView(name, { limit, sort })` finds the view by exact name, then by id. Two views with the same name are `INVALID_INPUT` with `reason: ambiguous_view_name` and the ids, and the user runs one by id. A name not found in a cut list says that the list was cut. It reads `customView(id).issues` with the issue fragment, maps the nodes as `searchIssues` does and applies pmkit's order and the limit (`finishSearch`). A cut issue read sets `hasMore`.
- `saveView`, `deleteView`, `renameView` answer `NOT_SUPPORTED`: "Linear views are created, renamed and deleted in Linear; pmkit reads and runs them".
- Manifest: `saved_views: { path: 'native', detail: { unsupported: ['saveView', 'deleteView', 'renameView'] } }`. `SERVED_BY.saved_views` adds `views delete` and `views rename`.
- The CLI text of a Linear view shows its stored Linear filter as compact JSON where a Local view shows `key=value` pairs.

### Commands and docs

- `commands/issues/run-view.md`: Linear is no longer refused in step 1; a Linear view has `filter: null` and its `linear.filterData`; the new `ambiguous_view_name` reason; the overrides.
- `commands/issues/find.md`: offer to save a view only when `saved_views` is native and `saveView` is not in `detail.unsupported`.
- `commands/local/doctor.md`: a view problem can be fixed with `views rename` / `views delete`.
- README CLI table, CHANGELOG, `skills/pmkit/SKILL.md` if it lists the CLI.

## Builder's calls

- Linear views are read and run only. Writing Linear views would need a reverse translation of `filterData` and a decision on shared views of other people, which no source settles; it is a follow-up candidate.
- A Linear view has no pmkit filter (`filter: null`), so `view_out_of_date` never applies there; a stale value in a Linear view is Linear's to report.
- `CustomView.issues` and `CustomView.modelName` come from Linear's public schema; no live check was run in this session (no key). `verify-api.mjs` gains a `custom_views` read so the next live check covers them.
