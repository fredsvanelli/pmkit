# PMK-252: Map issue docs on Linear

Design for the `docs` field of an issue on the Linear tracker. Source: PMK-228 (PR #196), which added `docs` on the Local tracker and left Linear unsupported.

## Decisions (the coordinator gave no one to ask, so these are the implementer's calls)

1. **A doc is a Linear attachment (a link) on the issue**, as the issue says ("stored as links on the issue"). pmkit creates it with `attachmentCreate` and removes it with `attachmentDelete`.
2. **The link needs a URL.** A docs path is a repository path, so the URL is `https://github.com/<git_host.repo>/blob/<default branch>/<path>` (each path segment percent-encoded). The default branch is `git_host.default_branch`, `main` when unset. The ADR file may not be merged yet; the link works once it is, and `record-decision` already says so in the comment.
3. **The path is the source of truth, not the URL.** The attachment carries `metadata: { pmkitDoc: <path> }`, its `title` is the path. A read lists only attachments with a string `pmkitDoc`; pull request links, Slack links and others are never docs. Order: `createdAt`, then path.
4. **No GitHub repo, no write.** With `git_host.system` other than `github`, or no `repo`, `--add-doc` is refused with `NOT_CONFIGURED` (next step `/pmkit:link-repo`) before any request. A read still works and lists what is there. `--remove-doc` of a path works without a repo (it matches by `pmkitDoc`).
5. **Read cost.** The issue fragment is not touched (it is at the complexity budget PMK-246 set). Attachments are read like releases: one batched query per 100 issues (`PmkitIssuesAttachments`, 20 attachments per issue, `id url`-sized fields, about 2.6k points), and a single paged read for an issue with more than 20. No read per issue in list, search or views.
6. **A refused or failed attachment read is unknown, never empty.** The issue comes back with `docsUnknown: <message>` (no `docs` key) and a `note:`; `issues get` prints `docs: unknown (...)`. A write with `docs` refuses when the read failed (so it never deletes from a list it could not see). The CLI refuses `--add-doc`/`--remove-doc` when the issue's docs are unknown.
7. **Write semantics.** The CLI sends the whole new `docs` list (Local semantics). The tracker diffs it against the attachments: `attachmentCreate` for added paths, `attachmentDelete` for removed. `--dry-run` reads and diffs but sends no mutation. When a mutation fails in the middle, the error says which paths were added or removed and which were not. `issues create` takes no docs (as before).
8. **record-decision** no longer skips the `docs` step on Linear: the step 6 text drops the "NOT_SUPPORTED on Linear" branch, keeps it for trackers that still answer it, and says the link is a Linear attachment.
9. **Manifest:** `issueDocs` leaves `documents.detail.unsupported` on Linear.

## Non-goals

Creating Linear documents (PMK-167), copying ADR text, docs on `issues create`, URL docs (`--add-doc https://...`).

## Acceptance criteria map

| Criterion | Where |
|---|---|
| `issues get` shows docs | `readNode` attaches docs, `toIssue` maps them |
| `--add-doc`/`--remove-doc`, dry-run sends no request | `updateIssue` diff, mutations only when not dry-run |
| record-decision links the ADR | `commands/spec/record-decision.md`, scenario goldens |
| Manifest | `manifest.mjs`, `manifest.test.mjs` |
