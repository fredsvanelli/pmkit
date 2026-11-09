# PMK-187: issues delete fixes

Follow-up of PMK-52 (PR #99). Small change, no new command, so no new scenario file.

## Decisions (made without the user; the orchestrator asked for no questions)

1. **Linear archived references.** The shared `ISSUE_FRAGMENT` stays as it is: adding `includeArchived` there would change `blockedBy`, `children` and `related` for every read. `delete` instead runs one extra read, `PmkitIssueReferences`, that selects `children`, `relations` and `inverseRelations` with `includeArchived: true`, plus matching later-page documents, and `referencesTo` runs on that node. If that read fails, the delete fails (nothing is sent), never "no references".
   The fake Linear API hides archived children and relations unless the nested field asks for `includeArchived: true`, as real Linear does.
2. **Local atomic removal.** Rename the folder to `.issues/issues/.deleting-<id>-<pid>` (same filesystem, ignored by `listIssueIds` since it is not an ID), then remove it. The rename is the delete: it either happens or the issue stays whole. A failed cleanup leaves only the hidden folder and adds a warning to the result that names the cause. The suffix is `<pid>-<timestamp>`, so a second leftover never collides. `validate` reports the folder with code `leftover` and the `rm -rf` step, and does not count it as an issue; `local-migrate import` does not count it as a held record. The deleted ID is not reserved: it can be created again.
3. **Preview text.** `removes.autoCommit` (JSON) says whether pmkit commits the delete. The "Only git history can bring them back" sentence shows only then; otherwise the text says nothing commits the delete. "1 event", "N events"; same for comments.
4. **Mentions.** URLs (`https?://...`) are cut out first, so a markdown link keeps its text. Then a token with a `/` or `\` that starts with `.`, `~` or `/`, has two separators or ends in a file extension is a path and is ignored, unless every part is an issue ID. `ISS-1/`, `ISS-1/2` and `ISS-1/ISS-2` stay mentions.

## Out of scope
`docs/superpowers/epc-6-follow-ups.md`.
