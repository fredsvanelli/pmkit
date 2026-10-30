# PMK-50: list the documents under the docs folder

## Intent

`docs read` and `docs create` work on one path at a time. A user or an agent needs to see which documents exist before reading one, and the spec operations table lists `list_documents` as the missing document operation. This adds `docs list`.

## Goals

- `pmkit docs list` prints the documents under `.issues/docs/`, one relative path per line.
- `pmkit docs list --json` returns the same list as an array of `{ "path": "..." }` objects.
- The tracker contract gets a `listDocuments()` operation, so every adapter has the same shape.
- `capabilities` reports `documents` as served by `docs list` too.

## Non-goals

- No body or title in the list. `docs read` returns the body.
- No Linear implementation. The Linear adapter answers `NOT_SUPPORTED` through its existing stub, as it does for `createDocument`.
- No filtering or sorting flags.

## Decisions (made by the implementer, no partner answer)

1. **Which files count.** Every regular file under the docs folder counts, whatever its extension, because `docs read` also accepts any path. Hidden entries (names starting with `.`, such as `.gitkeep`) and hidden folders are skipped.
2. **Missing or empty folder.** Both return an empty list, not an error. `init` creates the folder, but a tracker without it still answers `docs list` with no documents. When `.issues/docs` is a file, the command answers `CONFLICT` with a next step (rename or remove the file), not a raw `ENOTDIR`.
3. **Order and separators.** Paths are relative to the docs folder, use `/` on every platform, and are sorted by plain string comparison.
4. **Text output.** One path per line. An empty list prints `no documents`, as `epic updates` prints `no status updates`.
5. **Linear.** `listDocuments` is added to the Linear manifest's `unsupported` list for `documents` (`scripts/lib/linear/manifest.mjs`), so a skill reading the manifest does not offer `docs list` on Linear. The adapter's stub still answers `NOT_SUPPORTED` if the command runs anyway.

## Shape of the change

- `scripts/lib/local/documents.mjs`: new `listDocumentFiles(docsDir)`.
- `scripts/lib/local/tracker.mjs`: `listDocuments` wraps it and joins the returned object.
- `scripts/lib/contract.mjs`: `listDocuments` added to `TRACKER_OPERATIONS` after `createDocument`.
- `scripts/pmkit.mjs`: new `docs list` command after `docs read`.
- `scripts/lib/capabilities.mjs`: `documents` gains `'docs list'` in `SERVED_BY`. The goldens do not print `servedBy`, so `capabilities.txt` does not change.
- `scripts/lib/linear/manifest.mjs`: `documents` lists `listDocuments` in `unsupported` (decision 5).
- `CHANGELOG.md`: a line under `## Unreleased`.
- `scripts/golden-cases.mjs`: a `docs list` case. Its golden files are generated.
- `scripts/documents.test.mjs`: tests for the local operation.
- `README.md`: a row for `docs list`.

## Acceptance

- `docs list` lists the documents under the docs folder, as the issue requires.
- `npm test` passes.
