# PMK-266: tidy the Linear release, docs and archive code

## Problem

The reviews of PMK-246, PMK-250 and PMK-252 left seven cleanups. Only the first changes behavior, and only with an incomplete config: without `tracker.scope.team`, `release list` on Linear sends `{ eq: undefined }`, which matches every team's releases.

## Approaches

1. **One fix per point, each the smallest that removes the duplicate or the drift** (chosen). Output stays the same, which the existing tests and goldens check.
2. Rewrite the release reads around one helper module. More churn than the seven points need, for no visible change.

## Design

1. `scripts/lib/linear/releases.mjs`: `listReleases` and `resolveRelease` refuse with `NOT_CONFIGURED` (`tracker.scope.team is not set`, next step `/pmkit:setup`) when the team is unset, before any request, as `cycle-ops.mjs` does.
2. The fake (`scripts/fake-linear-api.mjs`) pages an issue's releases in the batch read by `BATCH_RELEASES_PAGE` (20), imported from `documents.mjs`, not by its generic nested page of 50. `API-VERIFICATION.md` says `releases(first: 20)`, "more than 20" and about 4,650 points; the comments in `documents.mjs` and `tracker.test.mjs` give the same figure. By Linear's rule (field 0.1, object 1, a connection times its page), an issue's release costs about 2.2 and an issue in the batch about 46, so 100 issues come to about 4,650.
3. `documents.mjs`: `RELEASE_FIELDS` is built from a shared base plus `pipeline { id }`; `RELEASE_QUERY` uses the base plus `pipeline { id teams(first: 250) { nodes { key } } }`. No `.replace`. A test asserts that `RELEASE_QUERY` reads `pipeline { id teams(first: 250) { nodes { key } } }`.
4. The canceled-release rule lives once: `releases.mjs` exports `activeReleases(nodes)` (the nodes whose stage is not `canceled`). `issueReleaseFields`, `writes.mjs` `activeReleaseIds` and the count in `issue-ops.mjs` use it.
5. The release-notes cut-off warning lives once: `release-notes.mjs` exports `NOTES_CUT`; `pmkit.mjs` warns with it and `format.mjs` prints `incomplete: ${NOTES_CUT}`. The words stay as they are, since the issue changes no output (see Interview).
6. `issues update` on Linear resolves the default branch once and only when the change adds a doc (`--add-doc`): it passes `docsBranch` and the default-branch note then, and neither for `--remove-doc` alone, which builds no link. `docUrl`'s comment says the CLI always passes the branch it resolved with `origin/HEAD`, and the fallback to the config is for a caller without git.
7. `archive` and `unarchive` are written once: in `scripts/lib/local/tracker.mjs` by one `setArchived(flag, op)`, and in `scripts/lib/bulk.mjs` by one builder helper that calls `tracker[method](issue.id, actor, options)`.

CHANGELOG line for point 1.

## Interview

- Does the cut-off warning need new words? It says "Linear" and 1000 whatever the tracker. Changing it changes output, which this issue rules out; it goes to a follow-up ticket in the EPC-5 follow-ups epic.
- Point 6, "calls git twice": `originHead` already reads git once per run (PMK-228's memo), so the double call is only `resolveDefaultBranch` twice; resolving once removes it.
- Point 6, `--remove-doc` alone today prints the default-branch note although no link is built. After the change it prints none: a note that was wrong goes away. Kept, as the issue asks for it.
- Point 1 on `resolveRelease`: with no team it answered `INVALID_INPUT` (no pipeline matched `undefined`) after a request; `NOT_CONFIGURED` before any request says what is wrong.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
