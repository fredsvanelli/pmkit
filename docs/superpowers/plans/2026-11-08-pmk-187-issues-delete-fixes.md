# PMK-187 plan

Each task is test first (`node --test <file>`), then the code, then a commit with `(PMK-187)`.

1. **Preview text** (AC3). Test in `scripts/cli-delete.test.mjs`: with `auto_commit` off the text has no "Only git history" and says nothing commits it; with it on the sentence stays; one event and one comment read "1 event and 1 comment". Code: `removes.autoCommit` in `deleteIssue` (`scripts/lib/local/tracker.mjs`), `deleteText` in `scripts/pmkit.mjs`. Update goldens in `scripts/__goldens__/`.
2. **Mentions** (AC4). Test: a description with a path and a URL holding the ID is not listed; plain text and `ISS-1/ISS-2` are. Code: strip path tokens in `deleteIssue`.
3. **Atomic removal** (AC2). Test: make the cleanup fail (a read-only parent is not portable, so the test stubs `fs.rmSync` through the tracker's injectable path if there is one, else asserts the rename-first order with a hidden folder left behind) and check `issues get` still answers NOT_FOUND cleanly and `validate` is clean. Code: rename then best-effort `rmSync`.
4. **Linear archived references** (AC1). Test in the Linear delete test file with the fake: an archived child and an archived related issue block the delete. Code: `documents.mjs` (new documents), `issue-ops.mjs` (`deleteIssue` reads references), `fake-linear-api.mjs` (honour `includeArchived` on nested fields).
5. **Close out.** CHANGELOG line under `## Unreleased`, docs that quote the changed text (`commands/issues/delete.md`, README if it quotes it), `--check 1..4`, commit `.issues/`, `npm test` in the foreground with exit code 0, verification, PR.
