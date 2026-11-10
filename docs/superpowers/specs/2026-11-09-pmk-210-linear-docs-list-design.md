# PMK-210: serve `listDocuments` on the Linear adapter

## Intent

PMK-50 added `docs list` and `listDocuments()` to the contract, served by the Local tracker only. Linear lists `listDocuments` as unsupported, so `docs list` answers `NOT_SUPPORTED` on a Linear tracker although Linear documents are readable (`docs read <slug>`). PMK-210 closes that gap and finishes the two doc loose ends from PMK-50.

## Goals

- `listDocuments()` works on the Linear adapter and returns the project documents of the configured team.
- The contract suite has a `listDocuments` case, so both adapters are held to the same shape.
- The operations table in `docs/superpowers/specs/2026-10-23-pmkit-design.md` lists `listDocuments()`.

## Non-goals

- No `createDocument` on Linear (stays `NOT_SUPPORTED`).
- No documents that belong to an initiative, a team or an issue. `documents` is `scope: project` in the manifest, and `docs read` only needs a slug, so the list covers project documents.
- No body in the list; `docs read` returns it.

## Decisions (made by the implementer, no partner answer)

1. **Shape.** `listDocuments()` returns `[{ path, title }]` on Linear, where `path` is the document slug (the same value `docs read` accepts, as `epic get` shows it). The Local tracker returns `[{ path }]`; the contract guarantees `path` (string), and `title` is extra on Linear. `docs list` text prints `path` only, as before.
2. **Scope.** Same as `listMilestones`: read the projects accessible to `scope.team`, then page through all documents and keep those whose project is in that set (Linear rejects some project filters on other collections, so the team is applied here). Needs a configured workspace (`requireWorkspace`).
3. **Order.** Sorted by `path` with plain string comparison, as the Local list is.
4. **Incomplete reads.** The paginator throws `UPSTREAM` when a page breaks. Hitting the page cap (`maxPages`) must not return a silent partial list: the call fails with `UPSTREAM` and a next step instead. `client.paginate` returns `hasMore: true` when it stops at the cap; the call turns that into the error.
5. **Manifest.** `documents.detail.unsupported` becomes `['createDocument']`. The capability path stays `native`, so the ADR-0001 counts do not change.
6. **Contract case.** Two cases in the `documents` family: a read-only one (`listDocuments` returns an array of objects with a string `path`, sorted, and an unknown path is not in it), and one in `documents` + `document-writes` (a created document appears in the list). Linear skips the second, as it skips the create test.

## Shape of the change

- `scripts/lib/linear/projects.mjs`: `DOCUMENTS_QUERY` (`PmkitDocuments`, paged, `slugId title project { id }`).
- `scripts/lib/linear/project-ops.mjs`: `listDocuments`.
- `scripts/lib/linear/tracker.mjs`: wire `listDocuments`.
- `scripts/lib/linear/manifest.mjs` (+ test): drop `listDocuments` from `unsupported`.
- `scripts/fake-linear-api.mjs`: route `PmkitDocuments`.
- `scripts/lib/linear/project-ops.test.mjs`, `tracker.test.mjs`: tests, including the team scope and a failing page.
- `scripts/contract-suite.mjs`: the two cases.
- `scripts/lib/linear/client-live.mjs`: a live read of the new query (read-only, no run here).
- `docs/superpowers/specs/2026-10-23-pmkit-design.md`: table row.
- `CHANGELOG.md`, `README.md` row text.

## Acceptance

- Each of the three issue criteria holds and `npm test` exits 0.
