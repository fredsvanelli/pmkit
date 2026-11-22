# PMK-265: keep issue docs in the Linear-to-Local migration

## Problem

PMK-252 stores a Linear issue's docs as attachments pmkit creates, with the path in `metadata.pmkitDoc`. The Linear snapshot of `local-migrate import` (`readLinearSnapshot`, `scripts/lib/linear/migrate-reader.mjs`) reads no attachment, `mapImport` (`scripts/lib/local/migrate-fields.mjs`) carries no `docs`, and the Local writer (`scripts/lib/local/migrate-writer.mjs`) writes none, so every issue loses its docs on the way to the Local tracker.

## Approaches

1. **Read the attachments in the snapshot with the batch query the adapter uses, let `toIssue` turn them into `docs`, and carry `docs` through `mapImport` and the writer** (chosen). `toIssue` already maps a node's attachments to `docs` and leaves out attachments pmkit did not create, so the filter of the acceptance criteria is the existing one.
2. Read each issue's attachments alone. One request per issue instead of one per 100.

## Design

- `migrate-reader.mjs`: after the issues and their nested pages, one `PmkitIssuesAttachments` request per 100 issues (`includeArchived: true`, so archived issues keep theirs); an issue whose list has a next page is read whole with `PmkitIssueAttachments`. A failed read fails the snapshot, as every other read of the snapshot does: a migration never writes from a partial read. The requests count in `readRequests`. Each snapshot issue gets `docs: issue.docs ?? []`, in normal form (`storedDocPath`), without repeats, since a Local `docs` list refuses repeats.
- `mapImport`: `...(item.docs?.length ? { docs: item.docs } : {})` in the issue fields.
- The Local writer writes `docs: fields.docs`; `serializeIssue` already writes the list and drops it when empty.
- The preview: the source line counts the docs (`N docs`, after the comments), so the dry run says how many docs it brings; each issue's `fields.docs` in the JSON lists them.

Tests: `scripts/lib/linear/migrate-reader.test.mjs` (a pmkit doc, a hand-made attachment, an issue with more than one page of attachments, an archived issue); `scripts/lib/local/migrate-fields.test.mjs` (`docs` carried); the import flow test (`scripts/cli-migrate.test.mjs`) checks the Local issue file has the docs and the dry run's source line counts them. CHANGELOG.

## Interview

- A hand-made attachment (no `pmkitDoc`): not a doc in `toIssue`, so neither carried nor counted.
- The other direction (Local to Linear) keeps listing docs as a loss: out of scope.
- The issue's history has no docs event: the writer's drift event (`driftEvents`) records the `docs` the frontmatter holds, as it does for any field the history lacks.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
