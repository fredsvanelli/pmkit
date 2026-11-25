# PMK-258: fix the Linear write edge cases for docs and releases

## Problem

The reviews of PMK-246 and PMK-252 left five cases where a Linear write reports the wrong outcome:

1. An attachment whose `pmkitDoc` is not in normal form (`./docs/a.md`, written by another client) is compared raw. A docs change normalizes its list to `docs/a.md`, sees it as new, upserts the attachment by its URL, then deletes the same attachment because `./docs/a.md` is not in the list. The doc is gone and the command says it worked. `--remove-doc docs/a.md` also misses it, since the CLI compares raw too.
2. After `issueUpdate` and `attachmentCreate` succeed, a failure of the final read-back (`RATE_LIMITED`) throws, so the command exits 2 although everything was written.
3. `docs\..\..\x.md` is one part when split on `/`, so it passes the `..` check and becomes a broken link.
4. `/pmkit:spec:record-decision` step 6 says nothing about a docs dry run that answers `CONFLICT` (a hand-made attachment with the ADR's link).
5. `release-notes` writes `release: null` for an issue in two releases or whose release could not be read.

## Approaches

1. **Fix each at its cause** (chosen): compare stored doc paths in normal form, in the adapter and the CLI; catch the read-back failure as `restore` already does; split the `..` check on both slashes; one rule in the command file; release-notes entries say what they know.
2. Rewrite stored metadata to normal form on read. A write to every issue a read touches, on attachments pmkit did not write: out of proportion, and a read must not write.

## Design

1. `scripts/lib/doc-path.mjs` exports `storedDocPath(path)`: `repoDocPath(path)`, or the path unchanged when it is not valid. `docChange` (`scripts/lib/linear/issue-ops.mjs`) compares the issue's doc attachments by `storedDocPath(metadata.pmkitDoc)`, so `./docs/a.md` is the doc `docs/a.md`: neither added nor removed when the list keeps it, removed when the list drops it. When a change keeps such a doc, the adapter adds a note: `<id> links docs/a.md as ./docs/a.md, written by another client; pmkit kept it as it is`. The CLI's `docLinks` (`scripts/pmkit.mjs`) matches `--remove-doc` against the stored paths in normal form on Linear.
2. `updateIssue` after a docs write: a `PmkitError` from the final read-back returns `{ before, after: <the preview: the update's answer with the new docs list>, warnings: ['<id> is updated and its docs are linked, but reading it back failed (<message>), so this record is the one pmkit expected: pmkit issues get <id> shows it as it is now'] }`. The CLI's `issues update` keeps the adapter's warnings next to the released-release warning, so exit code 0 and the warning in `--json` and on stderr.
3. `repoDocPath` refuses a path with a `..` part split on `/` or `\` ("leaves the repository"), before any request.
4. `commands/spec/record-decision.md` step 6: when an issue's docs dry run answers `CONFLICT`, skip the link for that issue, say that it already has an attachment with that link which pmkit did not create, and keep its comment; go on with the others. A static test in `scripts/` checks the rule is in step 6.
5. `scripts/lib/release-notes.mjs` `entryOf`: an issue with `releases` (two or more) gets `releases: [...]`, an issue with `releaseUnknown` gets `releaseUnknown: <message>`, and neither gets `release: null`; an issue with one release or none keeps `release` as today.

Tests: `scripts/lib/linear/tracker.test.mjs` for 1 and 2 (the fake answers the read-back with `RATE_LIMITED` once), a new `scripts/lib/doc-path.test.mjs` for 3, the CLI test for the `--remove-doc` match and the exit code, `scripts/release-notes.test.mjs` for 5. CHANGELOG.

## Interview

- Point 1, "says what it did": the note, in `notes` (the adapter's `takeNotes`), since `docs` already shows the list as stored.
- Point 2 covers the docs path only: a write without docs maps the update's own answer and sends no read-back after PMK-262, so nothing there can fail after the write but the context read, which is cached.
- Point 5 in text: the release-notes table has no release column, so only the JSON changes.
- Point 4: a `CONFLICT` is not a failure of step 6 (no write was tried), so it does not stop the step, unlike a failed comment or link.
- Where the warning of point 2 goes: the command's `warnings` (stderr and `--json`), merged with `releasedWarnings`, which today replaces any warning the adapter returns.
- New terms or ADRs: none.
- Approval: no product question; the acceptance criteria are the approval. pmkit PO approves.
