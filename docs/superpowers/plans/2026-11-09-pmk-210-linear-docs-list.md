# PMK-210 plan: `listDocuments` on Linear

Spec: `docs/superpowers/specs/2026-11-09-pmk-210-linear-docs-list-design.md`. Each task is test first.

1. **Fake and query** (`scripts/lib/linear/projects.mjs`, `scripts/fake-linear-api.mjs`). Add `DOCUMENTS_QUERY` (`PmkitDocuments($first, $after)`, nodes `slugId title project { id }`, page info) and route it in the project fake over the seeded documents, with `first`/`after` paging.
2. **Adapter operation** (`project-ops.mjs`, `project-ops.test.mjs`). Failing tests first: lists `{ path, title }` sorted by slug for the team's projects only (a project of another team is left out); empty list when no documents; `UPSTREAM` with a next step when `hasMore`; `requireWorkspace` applies. Then `listDocuments` (team projects as `listMilestones`, then documents filtered by project id, sorted by `path`) and export it.
3. **Wire and manifest** (`tracker.mjs`, `tracker.test.mjs`, `manifest.mjs`, `manifest.test.mjs`). Add `listDocuments` to `PROJECT_OPERATIONS` test and the guarded mapping check; `documents.detail.unsupported` becomes `['createDocument']`. Check `SERVED_BY` (`capabilities.mjs`) and the ADR-0001 counts do not move (path stays `native`).
4. **Contract case** (`scripts/contract-suite.mjs`). A `documents` case (array, string `path`, sorted) and a `documents` + `document-writes` case (a created document is listed). Run the suite against Local and the Linear fake (`contract.test.mjs`).
5. **Live probe** (`client-live.mjs`): a read-only `adapter.listDocuments()` array check beside `listMilestones`. Not run (no key here).
6. **Docs.** Add `listDocuments()` to the Documents row of the spec table (`2026-10-23-pmkit-design.md`), a `CHANGELOG.md` line under `## Unreleased` (top), the README row for `docs list`; no new command, so no scenario or `COMMANDS` change.
7. **Finish.** Mark the three acceptance criteria (`issues update PMK-210 --check n`, dry run then real), commit `.issues/`, `npm test` in the foreground with exit code 0, then open the PR.
