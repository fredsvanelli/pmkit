# PMK-229: improve investigate-bug (design)

Source: the three improvements in the issue. No business rule is missing, so no question went to the coordinator.
The brainstorming had no user to interview (the brief says to decide and go on), so these are the implementer's calls.

## Goals

1. `issues comment --redact`: the CLI redacts the body before it reaches the tracker, for any comment, not only the diagnosis.
2. `/pmkit:issues:investigate-bug` reads the code of the issue's branch, not the working tree, when the issue has a branch.
3. Scenarios for the degraded paths of the command: an issue with no branch, and `git_host: none`.

## Non-goals

- No new command file, no new capability, so no change to the counts of `scenarios.test.mjs`, `plugin.test.mjs` or the ADR.
- `text redact` stays as it is. The redaction rules (`scripts/lib/redact.mjs`) do not change.

## Decisions (implementer's calls)

### `--redact`

- The flag runs in the CLI layer (`scripts/pmkit.mjs`, `issues comment`), before `tracker.comment`, so Local and Linear behave the same and the dry run shows the same body the real run writes.
- It calls `redact()` on the body. When `count > 0` it appends a blank line and `summary` (`Redacted 2 values.`), the line the command file used to add by hand.
- It does not strip a `Redacted N values.` line already in the body: a draft never holds one, the CLI adds it. (The command file says so.)
- The JSON of `issues comment` gets `redacted: { count, counts, summary }` only when `--redact` was passed, so an agent reads what was replaced from the JSON, not only from the text. `notes` repeats `redacted N values: type n, ...` as `text redact` does.
- The body is redacted, then the tracker's empty-body check runs. A body that is only a secret becomes `[redacted]` plus the count line, so it is not empty and is posted. Accepted: the user sees it in the preview.
- Without the flag nothing changes.
- Step 10 of the command file becomes: 10.1 draft, 10.2 `issues comment --body-file <draft> --redact --dry-run --json` (shows the redacted comment and `redacted`), ask, 10.3 the same without `--dry-run`. The separate `text redact` call and the second file go away.

### Branch code

- Step 7 reads the code at a ref: `refs/heads/<branch>`, else `refs/remotes/origin/<branch>`, found with `git rev-parse --verify --quiet`. Files with `git show <ref>:<path>`, history with `git log <ref> -- <path>` and `git blame <ref> -- <path>`, search with `git grep <ref> -- <path>`.
- When neither ref exists, or the issue has no branch, it reads the working tree and says so (the code may not be the code of the bug). The command also says when the working tree is on another branch than the issue's, which is the reason for the change.
- A branch name that starts with `-` is not used in a command; the command reads the working tree and says why.
- `git blame <ref>` stays read-only.

### Scenarios

`issues-investigate-bug.mjs` becomes an array of three entries (snapshots `.0`, `.1`, `.2`):
- `.0` the existing happy path, with step 10 changed to `--redact`, and a `git` entry that reads the branch code at step 7.
- `.1` no branch: no `pr status`, `ci logs` or `pr diff` call; `deploys list` runs when the issue names an environment. The comment says the pull request, CI and diff were not read.
- `.2` `git_host: none` (the fixture default): `pr status` answers `NOT_SUPPORTED`, the diff is read with `git diff <default branch>...<branch>`, CI is not read.

## Tests

- CLI test for `--redact` (Local, dry run equals real body, count line, JSON `redacted`, no flag = unchanged, Linear via fake API).
- `plugin.test.mjs`/scenario rules keep the command file, the scenarios and the snapshots in step.
