# PMK-262: cut the extra release and docs reads on Linear

## Problem

PMK-246 and PMK-252 read an issue's releases (`PmkitIssuesReleases`, `PmkitIssueReleases`) and attachments (`PmkitIssuesAttachments`, `PmkitIssueAttachments`) wherever an issue node comes back: every `readNode`, every `mapped` after a write, every search before its own filtering. A write therefore reads them twice (before and after), reads that show neither (history, comments, delete, parent lookup) still send them, and a bulk change of 200 issues sends about 400 extra requests. The releases batch also marks the rest of a 100-issue chunk unknown when one issue's page read fails, where the docs batch marks only that issue.

## Approaches

1. **A bare read for the reads that show neither, a carry-over from the before-node for writes that change neither, attach after search filtering, and one batch helper for both lists** (chosen). Every request cut is one whose answer pmkit already has or never shows.
2. Cache the lists per issue id for the run. Hides when a write did change them (a release write, a docs write), so every write would need to invalidate the right entry; more state for the same cut.
3. Read the lists lazily in `toIssue`. `toIssue` is synchronous and used everywhere; making it async touches every caller.

## Design

All in `scripts/lib/linear/issue-ops.mjs` unless named.

- `readNode(id, { extras = true } = {})`: with `extras: false` it sends no release or attachment read. Bare callers: `getHistory`, `listComments`, `comment`, `resolveThread` (`history-ops.mjs`), `deleteIssue`, `parentNodeOf`.
- `keep(node, from, { releases = true, docs = true } = {}) -> node`: copies `releases`/`releasesUnread` and `attachments`/`attachmentsUnread` from `from` onto `node` where asked, so `mapped`'s attach calls skip them (they already skip a node that has the list or its unread mark). Exported with the ops.
  - `writeUpdate` maps its answer with `keep(node, beforeNode, { releases: !changesReleases(linearInput) })`, where `changesReleases` is `addedReleaseIds` or `removedReleaseIds` in the input. That covers update, move, assign, the bulk changes, `setParent` and `moveToCycle`.
  - `updateIssue` after a docs write: `keep(await readNode(before.id, { extras: false }), beforeNode, { releases: !changesReleases(linearInput), docs: false })`, so only the attachments (and the releases if the update set one) are read again.
  - `archive`: `keep(await readNode(id, { extras: false }), beforeNode)`.
  - `link` and `unlink` (`relation-ops.mjs`): the re-read of `a` is bare and keeps `a`'s lists. The delegate write (`history-ops.mjs`) maps its answer with `keep(updated, beforeNode)`.
  - `restore`: the read after the unarchive is bare and keeps the lists of the node it previewed.
- `searchIssues`: maps the rows without the lists, runs `finishSearch`, then attaches releases and docs to the nodes of the issues it kept (by identifier) and maps those again. A `--limit 5` search of 500 issues reads the lists of 5. The blocked check and the order read neither list.
- One batch helper, `attachInBatches(nodes, { query, field, unreadKey, readOne, unknown })`, used by `attachReleasesTo` and `attachDocsTo`: one request per 100 issues; an issue whose list has a next page is read alone (`readOne`), and a failure of that read marks only that issue unknown; a failure of the batch request marks the chunk's issues not yet read. The two `unknown` functions keep their note texts.

Tests (`scripts/lib/linear/tracker.test.mjs`, request names counted with the existing `namesOf`):

- `updateIssue` with a priority, `moveToCategory`, `assign`, `archive`, `link` send no release or attachment read after their write (`PmkitIssueUpdate`/`PmkitIssueArchive`/`PmkitRelationCreate` index onwards).
- `getHistory`, `listComments`, `deleteIssue` and `createIssue --parent <issue>` send none at all.
- A bulk change (`issues bulk priority` through `scripts/cli-bulk-linear.test.mjs` or the bulk builder over the tracker) of 3 issues sends 3 release and 3 attachment batch reads (one per issue before its write) and fails if more come back.
- A search with `limit: 1` over 3 issues sends one release and one attachment read for one issue.
- The releases batch: an issue whose own page read fails is unknown, and the other issues of the chunk keep their releases.

The existing tests and goldens check that every command shows what it showed before. CHANGELOG.

## Interview

- `delete`'s `before` comes from a bare read, so its JSON loses `release`/`releases`/`docs`. The issue names delete among the reads that show neither; the text output never shows them, and the existing delete tests and goldens stay green. Recorded in the PR as the one JSON difference.
- A release write (`--release`): `changesReleases` is true, so its after-read reads the releases again, as today.
- An unread list carried over stays unread with its note already taken; it is never turned into an empty list.
- Does the search change the issues it returns? No: `finishSearch` uses `blocked` and the sort keys, neither of which is a release or a doc.
- New terms or ADRs: none.
- Approval: no product question beyond the delete JSON point, which the issue's scope decides. pmkit PO approves.
