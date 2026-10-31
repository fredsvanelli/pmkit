# PMK-52: issues delete

## Intent

`issues delete <id>` removes an issue for good. It refuses when other issues reference it, and the command shows a full preview and asks before it deletes. Archiving is the reversible neighbor: `issues archive` keeps the record and its history and hides the issue from lists. Delete removes them. The command file says so in its first lines, so the user can pick archive when they only want the issue out of the way.

## Source rules

- Technical spec, write policy: `preview: [bulk, delete, publish_update, move_scope]`. A delete always shows the full preview.
- Conventions, "How to show a write": a bulk change, an archive, a scope move or a published status update always asks, whatever `write_policy.confirm` says. A delete is harder to undo than an archive, so it follows the same rule (builder's call). The conventions text gains "a delete".

## Acceptance criteria

1. The CLI deletes an issue and refuses when other issues reference it.
2. The command shows the full preview and asks before deleting.

## Every way a record points at an issue

Inbound means another record names the deleted issue. Only inbound references can dangle.

| Reference | Where it is stored (Local) | Decision |
|---|---|---|
| `blockedBy` of another issue (shown as `blocks` on this one) | other issue's file | Blocks. |
| `related` of another issue | other issue's file | Blocks. |
| `duplicateOf` of another issue | other issue's file | Blocks. |
| `parent` of another issue (shown as `children`) | other issue's file | Blocks. |
| Own `blockedBy`, `duplicateOf`, `related`, `parent` | this issue's file | Not a reference to it. They go with the file. |
| Epic, goal, milestone, release, sprint | the issue names them, they never name an issue | Does not block. A warning says the issue leaves the sprint or released release. |
| Saved view whose filter has `parent: <id>` | `views/<name>.yaml` | Warning. The view still runs and finds nothing. |
| Delegation | an assignee plus a comment inside the issue folder | Does not block. Warning when the assignee is an agent, which may still be working. |
| `todo-key:` line (PMK-64) | the issue's own description | Warning. The next `todos` run lists the comment as new again. |
| Time entries and events | the issue's own folder | Go with the folder. Warning with the minutes lost. |
| Comments and descriptions of other issues that cite the ID | other issues' files | Warning, listed as `mentions`. Text cannot dangle. |
| `branch` and its PR | issue field, git | Warning. pmkit never touches the branch or the PR. |
| Code comments, documents, `docs/` | outside the tracker | Not scanned. The text says so. |

Linear applies the same inbound rules from the issue node: a `blocks` relation out of the issue, a `related` relation in either direction, a `duplicate` relation into the issue, and `children`. Linear reports only what its API returns, so other issues' text, views and local code are listed as not checked.

A tracker whose issue files do not parse cannot be checked, because an unreadable file may hold a reference. The command refuses, lists the unreadable issues and points to `pmkit validate` and `/pmkit:local:doctor`.

## Behavior

- Contract operation `delete(id, actor, { dryRun })`, in `TRACKER_OPERATIONS` after `archive`. It returns `{ before, after: null, removes, references: [], mentions, warnings, unchecked }`. `after` is `null` because the issue no longer exists.
- Refusal: `CONFLICT`. The message lists each referrer and the kind of reference, and the next step names the first unlink command. The JSON error body carries `references: [{ id, kind }]`, so an agent reads the same list. A dry run refuses the same way.
- Local: removes `issues/<ID>/` (issue file, `events.jsonl`, `comments/`). The query index drops the entry in the same call. With `auto_commit`, the commit carries the removal (`pmkit: issues delete PMK-52`). Nothing else in `.issues/` changes.
- Linear: `issueDelete`, which moves the issue to Linear's trash, so the workspace can restore it for a while. The text says so.
- A second delete is `NOT_FOUND`, as for any unknown ID.
- Authorization is the same as for other writes (`requireWriter`, Linear viewer).

## Command file

`commands/issues/delete.md`. Steps: read, get the issue, dry run, show the full preview (record, files removed, warnings, mentions, the archive alternative), ask with `AskUserQuestion` whatever `write_policy.confirm` says, run for real. A refusal shows the referrers and the unlink commands and changes nothing.

## Non-goals

No `--force`, no cascade, no unarchive, no tombstone event, no trash for Local. Git history is the way back, and the preview says so.
