# PMK-222: improve issues delete

Follow-ups of PMK-52 (`issues delete`), collected in `docs/superpowers/epc-6-follow-ups.md`. Source spec: `2026-10-31-pmk-52-issues-delete-design.md`.

## Intent

`issues delete` already refuses while other issues reference the target, previews what goes and lists what it did not check. Five gaps remain: the repository files are never scanned for the ID, an issue in Linear's trash has no way back through pmkit, clearing several references takes one call each, the delete never ran against the live Linear sandbox, and three edge cases have no test.

## Goals

1. **Scan the repository for the ID (criterion 1).** The CLI layer of `issues delete` (both trackers) runs one `git grep -F -n -I --untracked -e <id> -- . ':(exclude).issues'` from the tracker root and keeps the lines that `mentionedIn(id)` accepts, so the mention rule is the one already used for issue texts. The result gains `files: [{ path, lines: [n, ...] }]`, sorted by path. On success the entry `code comments, documents and docs/` leaves `unchecked`. When git fails (not a repository, git missing, any exit status other than 0 or 1), `files` is `[]` and the entry stays in `unchecked` with the reason, so a failed read is never "no mentions". The text lists up to 10 files with their lines and says how many more are in `--json`. The ID is checked by the tracker before the scan runs (the scan runs after the tracker call), and is passed as an argument array, never through a shell.
   - On Linear the tracker's `unchecked` also gains `Linear documents`, so removing the repository entry does not hide that project documents in Linear were not read.
2. **Restore from Linear's trash (criterion 2).** New CLI command `issues restore <id>` and tracker method `restore(id, actor, { dryRun })`.
   - Linear: read the node with trashed issues allowed. An issue that is not trashed is `INVALID_INPUT` ("<id> is not in Linear's trash"). A dry run returns `{ before: null, after }` with the issue as it comes back. The real run sends `issueUnarchive` once; `success !== true` is `UPSTREAM`. Then it reads the issue again for `after`.
   - Local: `NOT_SUPPORTED`. The Local tracker has no trash; the message and next step name the two git commands that bring the folder back (`git log --diff-filter=D -1 --format=%h -- .issues/issues/<id>`, then `git checkout <commit>^ -- .issues/issues/<id>`). A malformed ID is `INVALID_INPUT` before that.
   - `restore` joins the tracker contract (`scripts/lib/contract.mjs`). The contract delete test restores the issue where the tracker supports it and expects `NOT_SUPPORTED` on Local.
   - The delete text on Linear names `pmkit issues restore <id>`. `commands/issues/delete.md` names it in its Output. No new slash command: the CLI command is enough for the agent, and the README table gains the row.
3. **Several targets for `issues link --remove` (criterion 3).** `issues link <from> <to...> --kind k --remove`. Several targets need `--remove`; without it the call is `INVALID_INPUT`. A target named twice is `INVALID_INPUT`. One target keeps today's JSON exactly. Several targets run one unlink after another, each as the single-target call does, and return `{ results: [{ to, before, after, other? }] }`. A dry run runs each unlink as a dry run.
   - A failure in the middle stops the run, as `issues bulk` does: the error keeps its code, its message names the target and how many unlinks ran, `written` carries `{ applied, failed: { to, code, message }, remaining }`, and `partialCommit` lets `auto_commit` commit what was written.
   - The refusal of `issues delete` groups its next steps: all `blockedBy` references in one `pmkit issues link <id> <a> <b> --kind blocks --remove`, all `related` references in one `pmkit issues link <id> <a> <b> --kind related --remove` (a related link counts both ways on both trackers, so `<id>` can be the first argument). `duplicateOf` and `parent` stay one command each, because their direction does not allow `<id>` first. `error.references` does not change.
4. **Live sandbox (criterion 4).** The contract delete test is in the `issues` family, which the Linear live run already covers. The live allowlist gains `issueUnarchive` for the run's own issues, so the restore runs live too, and `API-VERIFICATION.md` gains the command line and the facts to check. Running it needs `LINEAR_API_KEY` and `PMKIT_LIVE_WORKSPACE`. **Builder's note:** this worktree has neither, so the run itself is left for someone with the key, and the criterion stays unchecked until then.
5. **Tests (criterion 5).** Local tracker and CLI: `../<id>`, `<id>/..` and `../../etc` are refused and nothing on disk changes; an epic ID (an existing epic) is `NOT_FOUND` and the epic folder stays. Linear: a `../` ID sends no request; an epic key is `NOT_FOUND` with no mutation; `issueDelete` answering `success: false` is `UPSTREAM` and the issue is still readable.

## Non-goals

- Restoring a Local issue from git automatically. The error names the commands.
- Linking several targets at once (without `--remove`): the criterion asks for removal only, and a link has cycle checks per pair.
- Defects found in the PMK-52 reviews (their own bug issues).

## Constraints

- Lessons of `docs/superpowers/epc-6-orchestration/lessons.md`: a read that can come back incomplete says so (the git scan); batch writes say what happens on a failure in the middle and test it; `spawnSync` gets a large `maxBuffer`; every message the command file repeats exists in the JSON.
- No change to `.issues/` by hand.

## Calls made by the builder

- Scan in the CLI layer, not in each tracker, so both trackers get it from one place.
- `files` grouped per file with line numbers, no cap in JSON; the text caps at 10 files.
- `issues restore` as a CLI command only, no `commands/issues/restore.md`.
- Grouped next steps in the delete refusal for `blockedBy` and `related` only.
