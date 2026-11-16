# PMK-250: unarchive issues on the Local tracker

## Intent
`issues archive` (and `issues bulk archive`) has no way back on the Local tracker: an archived issue leaves every list and bulk change, and only a hand edit of `issue.md` restores it. A wrong bulk archive cannot be undone.

## Goals
- `pmkit issues unarchive <id>` brings one archived Local issue back, with `--dry-run` and an `unarchive` event in its history.
- `pmkit issues bulk unarchive --archived <filter>` brings back every archived issue its filter matches, after the usual preview and digest.
- Unarchiving an issue that is not archived writes nothing and says so (text and JSON).

## Non-goals
- Linear. The adapter gets an `unarchive` contract operation that answers `NOT_SUPPORTED` (a trashed issue is `issues restore`).
- Restoring deleted issues (`issues restore`).
- A command file under `commands/` (`issues archive` has none either), so no new scenario.

## Design
- Event op `unarchive` (`EVENT_OPS`). `replay` sets `archived = false` so drift detection stays right; `metrics.mjs` clears its archived flag on it.
- Local tracker `unarchive(id, actor, { dryRun })`, the mirror of `archive`: no event and `before === after` when the issue is not archived.
- Contract operation `unarchive`; Linear stub refuses with `NOT_SUPPORTED`, next step names `issues restore` and the Local setting.
- CLI `issues unarchive <id>`: output reads `no change` plus `<id> is not archived, nothing changed`; JSON carries `unchanged: true` and `message`. `OWNED.archived` stays pointing at `issues archive`.
- Bulk `unarchive` (no value). The filter must carry `--archived` (the search only returns archived issues then); `checkBulkFilter` accepts `archived` for this change and still refuses it for the others. The run keeps only the issues that are archived, so the preview never lists live issues. A saved view works only when its filter has `archived`. Bulk flags gain `archived`.
- Bulk warning on archive stays; unarchive adds none.

## Decisions I made
- Bulk without `--archived` is refused (INVALID_INPUT) instead of implying it, so the user sees archived issues were what they meant to match.
