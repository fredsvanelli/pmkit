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

1. **Shape.** `listDocuments()` returns `[{ path, title }]` on Linear, where `path` is the document slug (the same value `docs read` accepts, as `epic get` shows it). The Local tracker returns `[{ path }]`; the contract guarantees `path` (string), and `title` is extra on Linear. `docs list` text prints `path  title` when there is a title, and `path` alone otherwise (Local).
2. **Scope.** One server-side filter, `documents(filter: { project: { accessibleTeams: { some: { key: { eq: scope.team } } } } })`, so the page cap applies to the team's documents and not to the whole workspace, and no project list is read. Needs a configured workspace (`requireWorkspace`). The filter shape follows the public schema (`DocumentFilter.project: ProjectFilter`); a live check with `client-live.mjs` is pending. Without `scope.team` the list should cover every team: a follow-up, with `listDeliverables` and `listMilestones`.
3. **Order.** Sorted by `path` with plain string comparison, as the Local list is.
4. **Incomplete reads.** The paginator throws `UPSTREAM` when a page breaks. Hitting the page cap (`maxPages`) must not return a silent partial list: the call fails with `UPSTREAM` and the next step `pmkit epic get <project>` instead. `client.paginate` returns `hasMore: true` when it stops at the cap; the call turns that into the error.
5. **Manifest.** `documents.detail.unsupported` becomes `['createDocument']`. The capability path stays `native`, so the ADR-0001 counts do not change.
6. **Contract cases.** In the `documents` family, the list is an array of objects with a string `path`, sorted, and holds every document the setup's `seedDocuments()` adds (so it cannot pass on an empty list; the Linear contract test seeds two). In `documents` + `document-writes`, documents created out of order are listed in path order. Linear skips the second, as it skips the create test.

## Shape of the change

- `scripts/lib/linear/projects.mjs`: `DOCUMENTS_QUERY` (`PmkitDocuments`, filtered and paged, `slugId title`).
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
