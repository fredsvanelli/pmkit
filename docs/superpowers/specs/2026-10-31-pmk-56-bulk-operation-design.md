# PMK-56: issues bulk

## Intent

`issues bulk <change> <value>` applies one change to every issue a filter returns. It always shows the full preview and asks before it writes. The conventions already say so: a bulk change shows a full preview and asks, whatever `write_policy.confirm` says. The CLI backs that rule with a digest, so the set the user approved is the set the command writes.

Sources: Unified model, Foundation catalog (`bulk-operation`: "Mass changes with preview"); Linear tab ("Move everything labeled legacy to project Y"; "always with preview and confirmation").

## Acceptance criteria

1. Applies one change to every issue a filter returns.
2. Always shows the full preview and asks first.

## Decisions (builder's calls, no user was available to ask)

- Filter: the flags of `issues list` (`--text`, `--category`, `--type`, `--assignee`, `--label`, `--sprint`, `--parent`, `--blocked`, `--updated-before`, `--updated-after`), or `--view <name>` for a saved view (PMK-44). Not both. At least one is required, so a bare `issues bulk move done` never means "every issue". `--sort`, `--limit` and `--archived` are not accepted: a limit would cut the set, and archived issues stay out of a bulk change. The same rules apply to the filter of a saved view: one with `archived` or `limit`, or with only a `sort`, is refused (a `sort` next to a criterion is fine and only orders the table), and so is any empty value (`--text ""`), because it matches every issue.
- Changes, one per call, each through an existing contract operation. There is no new write path.

| Change | Value | Operation |
|---|---|---|
| `move` | category, with `--status name` | `moveToCategory` |
| `assign` | member, `me` or `none` | `assign` |
| `priority` | priority or `none` | `updateIssue` |
| `estimate` | number or `none` | `updateIssue` |
| `label-add` | label | `updateIssue` with the new list |
| `label-remove` | label | `updateIssue` with the new list |
| `milestone` | id or `none` | `updateIssue` |
| `release` | id or `none` | `updateIssue` |
| `sprint` | id, `current` or `none` | `moveToCycle` |
| `parent` | issue id or `none` | `setParent` |
| `link` | issue id, with `--kind` and `--remove` | `link`, `unlink` (each matched issue is the `from` side) |

- Batch cap: 50 issues by default, `--max n` up to 200. A bigger match is refused with the count, in the dry run and the real run. Nothing is truncated.
- The preview is frozen with a digest, as `local-migrate` does (PMK-41). `--dry-run` prints a `sha256:` digest of the change and of each matched issue (its id, its `updated` stamp and the fields that would change). The real run needs `--expect <digest>`. It reads the filter again, rebuilds the preview, and refuses with `CONFLICT` when the digest differs. Nothing is written in that case, and the JSON error carries `expected` and `digest`.
- `label-add` and `label-remove` take one label. A value with a comma is `INVALID_INPUT`, because it would add a label named "a,b".
- Per issue states in the preview: `change` (will be written), `unchanged` (before equals after, never written), `rejected` (the operation refused it in a dry run, with the error code and message).
- Nothing is written when the read is incomplete or the preview has a problem. The result has `writable: false` and a `blockers` list, and the real run refuses with `INVALID_INPUT`. Blockers: unreadable issues (`problems` of the search, which may hold a match) and an issue the operation rejected for its own reasons. A dry run still shows what it found. A read the tracker cut (`hasMore`, Linear reads at most 1000) has one path: `INVALID_INPUT` before any preview, in the dry run and the real run, because a cut set is not the set to preview.
- A wrong value is one error, not a blocker per issue. When the dry run of every matched issue fails with the same error (an unknown member, an estimate off the scale, a sprint that does not exist, an agent on Linear), the command fails with `INVALID_INPUT` and the next step of that error, before it builds the preview. A single issue that fails a `link` or `parent` change stays a blocker, because its own state may be the cause.
- `release` warns, as `issues update --release` does, when the release is already released. The warning is in `warnings` of the result and on stderr.
- `NOT_SUPPORTED` from an operation aborts the whole command: the change is not available on that tracker, which is not a fact about one issue. Linear does not write `milestone` or `release`, so those fail that way, with the message of the operation. An epic works as `parent` on Linear, as it does for `issues parent`.
- A write that fails midway stops the batch. The error keeps the code of the failing write, which can be `CONFLICT`, so the command file reads `result.applied` and `result.failed` before the code. Its message says how many issues were written, and `result` in the JSON error body lists `applied`, `failed` and `remaining`. The `digest` of a `CONFLICT` is never an `--expect` value. The command never retries. With `auto_commit` the issues already written are committed.
- No new capability. `issues bulk` is not a Unified model capability, so the manifest and `SERVED_BY` stay as they are.

## Command file

`commands/issues/bulk.md`, `/pmkit:issues:bulk <change> <value> [filter]`. Steps: read the conventions, map the request to a change and a filter (a vague request is turned into flags and shown), dry run, show the whole preview (table with the matched issues and the change per issue, `unchanged`, `rejected`, warnings, the digest), ask once whatever `write_policy.confirm` says, run the same command with `--expect <digest>` and without `--dry-run`, show the applied list. On a failure show `applied`, `failed` and `remaining` and stop. Declining changes nothing.

## Non-goals

No several changes in one call, no `create` or `delete` or `archive`, no resume of a stopped batch (a new dry run lists what is left), no edit of title, description or criteria, no due date or type change (candidates for a later issue).
