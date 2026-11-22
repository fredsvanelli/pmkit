# PMK-259: unarchive issues on Linear

## Problem

PMK-250 added `issues unarchive` and `issues bulk unarchive` on the Local tracker. On Linear both answer `NOT_SUPPORTED` (the tracker's `unarchive` stub, and two early refusals in `scripts/pmkit.mjs` for `bulk unarchive`), although Linear's `issueUnarchive` brings back an archived issue that is not in the trash. `issues restore` already sends `issueUnarchive` for a trashed issue (PMK-222).

## Approaches

1. **An `unarchive` in the Linear issue operations with the Local tracker's contract, and the two early refusals kept for GitHub only** (chosen). The CLI commands, the dry run, the preview and the "nothing changed" answer are already tracker-neutral; only the adapter call and the refusals are Local-only.
2. Route unarchive through `restore`. `restore` refuses an issue that is not trashed and returns a create-shaped result (`before: null`); the two cases differ in what the user sees.

## Design

- `scripts/lib/linear/issue-ops.mjs` `unarchive(id, actor, { dryRun })`:
  - The issue is read with `readNode`. A `NOT_FOUND` is checked once more with the raw `PmkitIssueById` read: a trashed issue is refused with `INVALID_INPUT` "`<id>` is in Linear's trash, not archived", next step `pmkit issues restore <id>`; otherwise the `NOT_FOUND` stands.
  - Not archived: `{ before, after: before }`, which the CLI turns into "`<id>` is not archived, so nothing changed".
  - Dry run: `{ before, after: { ...before, archived: false } }`, no request that writes.
  - Otherwise `issueUnarchive` (`ISSUE_UNARCHIVE`, the restore's mutation), then the bare read-back keeping the lists (PMK-262). A failed read-back after the write is a warning, as `restore` does.
- `scripts/lib/linear/tracker.mjs`: `unarchive` is the issue operation instead of the stub.
- `scripts/pmkit.mjs`: the two early `bulk unarchive` refusals apply to GitHub only. `issues unarchive`'s summary says Local and Linear.
- `unarchiveNotSupported` (`scripts/lib/errors.mjs`), now reached only on GitHub: "unarchive works on the Local tracker and Linear, not on GitHub", same next step. The GitHub tests and the GitHub issues runbook take the new words.
- `bulk unarchive --archived` on Linear needs nothing new: the search sends `includeArchived` and the CLI keeps the archived issues only; a trashed issue maps to no issue and is never listed.
- Docs: `commands/issues/bulk.md` (`unarchive` on the Local tracker and Linear, refused on GitHub before any read), `README.md` (the two rows and the GitHub list), `commands/issues/update.md`'s pointer. CHANGELOG.
- The sandbox guard already takes `issueUnarchive` on the run's own issues (PMK-222), so the live run can send it.

Tests: `scripts/lib/linear/tracker.test.mjs` (archived → back in `searchIssues`; dry run sends no mutation; not archived → unchanged, no mutation; trashed → `INVALID_INPUT` naming `issues restore`); `scripts/cli-bulk-linear.test.mjs` (`bulk unarchive --archived --label x` previews the archived matches only and the real run brings them back), replacing the two `NOT_SUPPORTED` tests. A live probe of one archive and unarchive on the sandbox team.

## Interview

- Bulk preview on Linear: the same preview and digest as every bulk change; a mid-run failure stops and lists what changed, as `runBulk` already does.
- Does `issueUnarchive` on an archived issue also take it out of the trash? It does not apply: a trashed issue never reaches the mutation.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
