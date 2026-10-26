# PMK-6: commit each operation when auto_commit is on

Issue: PMK-6, epic EPC-1 ("Local tracker: close the gaps of 0.1.0"). Branch `pmk-6-commit-each-operation-when-auto-commit`.

This spec was written without a human in the loop. Every decision below is Claude's call, made from the issue, the code, `CONTEXT.md`, `docs/adr/` and `docs/superpowers/specs/2026-10-23-pmkit-design.md` (sections "Writes and commits" and "Format and migrations", and the anti-goal on commits). The planning doc that the issue cites ("Local adapter" tab, Collaboration item 4, decision L5) is not in the repository. The design spec's summary of it is the source used here: "With `auto_commit: true`, the CLI then runs `git add` on the changed paths and commits with the message `pmkit: <op> <id>`. Off by default."

## Intent

A team that turns on `auto_commit` wants each tracker write to land as its own commit, so the tracker history reads as a list of operations and a teammate can pull them without a manual commit step. The commit must hold the files that this write changed and nothing else. A user who has a half-written doc under `.issues/docs/`, a hand edit to another issue, or staged code must not find those inside a `pmkit: issues move ...` commit.

## Current state

The issue text says nothing reads `auto_commit`. That is out of date. `scripts/pmkit.mjs` already has most of the feature:

- Each tracker write command returns a `commit` field with the id for the message (`issueWrite` and the explicit returns in `cycle *`, `epic *`, `docs create`, `issues comment`, `issues log-time`, `issues branch`, `pr sync`).
- `run()` commits after the command when `command.write`, not `--dry-run`, `result.commit !== undefined` and `local.auto_commit === true`. The message is `pmkit: <command> <commit>`.
- `commitTracker(config, message)` runs `git add -- <tracker.path>`, returns when `git diff --cached --quiet -- <tracker.path>` finds nothing, then runs `git commit -m <message> -- <tracker.path>`. A failure throws `UPSTREAM` and the CLI still prints the written result, exit code 2.
- `runMigrate` commits once as `pmkit: migrate tracker format <from> to <to>` and reports it in `data.commit`.
- `pr open` and `pr ready` change no tracker file and return no `commit`. `pr sync` returns no `commit` when it moved nothing. `init` is not a `write` command and never commits.

Tests that exist today:

| Test | File | What it proves |
|---|---|---|
| `auto_commit commits only the tracker folder with pmkit: <op> <id>` | `scripts/cli.test.mjs` | `issues create` commits with the right message; a file staged outside the tracker stays staged and out of the commit; one `issues move --dry-run` adds no commit |
| `a failing auto_commit exits 2 with one JSON value that carries the result` | `scripts/cli.test.mjs` | a rejected commit gives `UPSTREAM`, keeps the written files and prints the result |
| `pr sync with nothing merged moves nothing and does not commit` | `scripts/cli-pr.test.mjs` | no commit when nothing moved |
| `pr sync commits with the moved ids when auto_commit is on` | `scripts/cli-pr.test.mjs` | message `pmkit: pr sync <ids>` |
| `migrate writes what the dry run listed` | `scripts/migrations.test.mjs` | with `auto_commit: false`, migrate adds no commit |
| `migrate with auto_commit commits once with its own message` | `scripts/migrations.test.mjs` | one commit, clean tree after |
| `migrate --dry-run returns the plan and writes nothing` | `scripts/migrations.test.mjs` | dry run leaves the tracker unchanged (no git check, `auto_commit: false`) |
| `every write is byte-identical on --dry-run` | `scripts/cli.test.mjs` | every write command writes nothing on `--dry-run`, in a folder that is not a git repository and has `auto_commit: false` |

## The gap

1. **The commit sweeps up every change under the tracker folder.** `git add -- .issues` stages every modified or new file there, and `git commit -- .issues` commits every path under it, staged before or not. A probe on the `team` fixture confirmed it: with a hand edit to `ISS-1V9Z/issue.md` and a staged `.issues/docs/draft.md`, `issues assign ISS-0G5E ana` made the commit `pmkit: issues assign ISS-0G5E` that holds those two unrelated files. This breaks the first acceptance criterion ("only the tracker files it changed").
2. **No test runs every write command with `auto_commit: true` and `--dry-run` in a git repository.** The code guards the commit in one place, so the behavior is right today, but the third criterion has a test for one command (`issues move`) and for `pr sync` only through `hashTree`.
3. **No CLI test runs writes with `auto_commit: false` in a git repository and checks that HEAD did not move.** Only `migrate` has that check. The second criterion holds in code (the default template has `auto_commit: false` and the guard compares with `=== true`) but the CLI path has no test.
4. **No test shows that each write makes exactly one commit** for commands that touch several files (`issues link --kind related` writes two issues, `cycle add` several, `pr sync` several).

Commands that are already right and stay as they are: `init` (never commits), `pr open` and `pr ready` (no tracker files), the commit message format, the `UPSTREAM` failure path.

## Goals

- With `auto_commit: true`, a tracker write makes one commit that holds exactly the files that write created, changed or appended to.
- Changes the user had under the tracker folder before the write, staged or not, stay where they were: not committed, and still staged or unstaged as before. The one exception is a file the write itself changes (see decision 3).
- Changes outside the tracker folder stay out of the commit, as today.
- Tests that pin each acceptance criterion across every write command.

## Non-goals

- Committing `init`. It writes `.pmkit/config.yaml`, which is outside the tracker, and `/pmkit:setup` shows its diff for the user to commit.
- Changing the commit message format, or adding a body, trailer or author override.
- Pushing, or any remote git operation.
- Partial-file (hunk) commits.
- A setting per command, or a flag that turns the commit on or off for one run.

## Anti-goals

- A `pmkit:` commit that contains a file the user did not ask pmkit to write. That is the failure this issue exists to remove, and it is worse than no commit, because the user may push it without looking.
- A write that refuses to run because the tracker folder is dirty. With `auto_commit` on, a failed commit (a hook, a missing `user.email`) leaves the folder dirty, and refusing every later write would lock the user out of the tracker.
- Any commit when `auto_commit` is not `true`, or on `--dry-run`.

## Approaches considered

**A. The tracker records the files it writes (recommended).** The Local tracker keeps a list of every file it writes during one run: each `writeFileAtomic` and each `appendEvents` that appends at least one line. The CLI reads that list after the command and commits those paths only, with `git add -- <paths>` then `git commit -m <message> -- <paths>`. A commit with explicit paths commits only those paths, so other staged entries stay staged. It is exact, needs no git call before the write, and matches the design spec's "`git add` on the changed paths". The cost is that every write site in `scripts/lib/local/` must report through one recorder, and a new write site that skips it would leave a file out of the commit.

**B. Compare `git status` before and after.** The CLI runs `git status --porcelain -- <tracker.path>` and hashes the dirty files before the command, does it again after, and commits the paths that are new in the list or whose hash changed. It needs nothing from the tracker. It costs a status and a hash of every dirty file before every write, even when the commit then fails, and it cannot tell a file the write left byte-identical from one it never touched. It also reads git state the write does not need when `auto_commit` is on and the tree is clean, which is the common case.

**C. Refuse when the tracker folder is dirty.** Like `migrate`, a write with `auto_commit: true` refuses with `CONFLICT` when `git status --porcelain -- <tracker.path>` is not empty, and then `git add -- <tracker.path>` is exact. It is the smallest change. It hits the anti-goal above: one failed commit blocks every later write, and a draft doc under `.issues/docs/` blocks all issue work.

A is the choice. B is the fallback if a reviewer objects to touching the tracker library, and it would satisfy the same tests.

## Design

### Recording written files

The Local tracker created by `createLocalTracker` keeps a set of the absolute paths it has written since it was created. Every file write inside `scripts/lib/local/` goes through it:

- `save()` (issue file and its events), `change()` (drift events and events-only writes), `comment()`, `writeSprint()`, epic create, epic status update, and `createDocument()` (through `createDocumentFile`).
- An `appendEvents` call with an empty list writes nothing and records nothing.
- A dry run records nothing, because it writes nothing.

The tracker exposes the list as a method, `writtenFiles()`, which returns the paths relative to the project root, with `/` separators, sorted. How the recording happens (wrappers in `tracker.mjs`, an `onWrite` option passed to `store.mjs` and `documents.mjs`, or another way) is the builder's choice, as long as one test fails when a write site skips it (see Tests).

`migrate` does not use the tracker for its writes and keeps its own commit (decision 5).

### Committing

`run()` keeps its guard (`command.write`, not `dryRun`, `result.commit !== undefined`, `auto_commit === true`) and passes the written files to the commit:

1. If the tracker was never created in this run, or `writtenFiles()` is empty, there is no commit and no error.
2. `git add -- <paths>` from the project root. This picks up new files, which `git commit -- <paths>` alone refuses.
3. `git diff --cached --quiet -- <paths>`. If nothing differs from HEAD (a write that rewrote a file byte for byte), there is no commit.
4. `git commit -m "pmkit: <command> <commit>" -- <paths>`.

Every git call runs with `--literal-pathspecs` (or `GIT_LITERAL_PATHSPECS=1`), because a document path such as `notes/[draft].md` would otherwise be read as a glob. The paths are relative to the project root and git runs with that root as its working directory, so a project inside a subfolder of a larger repository still works. If the number of paths could exceed the argument limit, the builder may pass them through `--pathspec-from-file=- --pathspec-file-nul` instead; with the commands that exist today the list stays small.

A failure at step 2 or 4 keeps today's behavior: `UPSTREAM`, the message `the write succeeded but auto_commit failed: <git output>`, the next step `Commit <paths> yourself` (it now names the files when there are 5 or fewer, and the tracker folder otherwise), the written result in `error.written`, exit code 2.

`commitTracker` changes signature to take the paths. `runMigrate` calls it with the tracker folder as its one path, so both callers share the git steps.

### Commands

| Command | Commits with `auto_commit: true` | Files in the commit |
|---|---|---|
| `issues create`, `update`, `move`, `assign`, `parent`, `archive` | yes | the issue's `issue.md` and `events.jsonl` |
| `issues link` | yes | for `related`, both issues' files; for `blocks` and `duplicate`, the one issue whose list changes |
| `issues comment` | yes | the comment file and the issue's `events.jsonl` (plus `issue.md` only if drift settling rewrote it; today it does not) |
| `issues log-time` | yes | the issue's `events.jsonl` |
| `issues branch` | yes, on the new branch after `git switch -c` | the issue's `issue.md` and `events.jsonl` |
| `cycle open`, `capacity`, `close` | yes | the sprint file (and issue files if `close` writes them) |
| `cycle add` | yes | each moved issue's files |
| `epic create` | yes | `epic.md` and the epic's `events.jsonl` |
| `epic update-status` | yes | the update file |
| `docs create` | yes | the document |
| `pr sync` | yes when it moved at least one issue | each moved issue's files |
| `pr open`, `pr ready` | no | none (no tracker file changes) |
| `migrate` | yes, own message | the tracker folder (decision 5) |
| `init` | no | none (decision 4) |

A write that changes nothing, such as assigning the current assignee with no drift, records no file and makes no commit.

### Documentation

- `templates/issues.config.yaml`: a comment above `auto_commit` that says what it does: each pmkit write commits the files it changed as `pmkit: <command> <id>`.
- `README.md`: one sentence next to the command table about `auto_commit`.
- `CHANGELOG.md`: an entry under the next version, written at delivery. No `Tracker format` change and no `Setup:` line, because the key already exists in every config.

## Tests

All new tests run the CLI in a git repository built from a fixture, with `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM` set as the existing tests do.

1. **Only the written files.** With `auto_commit: true`, a hand edit to another issue's `issue.md`, an untracked `.issues/docs/draft.md`, a staged `.issues/docs/staged.md` and a staged file outside the tracker: `issues assign` makes one commit whose file list equals the files that write touched. After it, `git status --porcelain` still shows the other three changes with the same staged or unstaged state.
2. **One commit per write, several files.** `issues link A B --kind related` and `cycle add A B --to <sprint>` each add exactly one commit, holding both issues' files.
3. **Every write command commits once.** A table over every command with `write: true` that returns `commit` (the list in "Commands" above, excluding `pr *` and `migrate`, which have their own tests): each run adds exactly one commit with the message `pmkit: <command> <id>`, and leaves no uncommitted change under the tracker folder. This is the test that fails when a write site skips the recorder.
4. **`auto_commit: false` never commits.** The same table with `auto_commit: false`: HEAD does not move, and the written files show as uncommitted changes.
5. **`--dry-run` never commits.** The same table with `auto_commit: true` and `--dry-run`: HEAD does not move and `git status --porcelain` is empty. Add `issues branch --dry-run` and `pr sync --dry-run` with the fake `gh` from `cli-pr.test.mjs`, and `migrate --dry-run` with `auto_commit: true` in `migrations.test.mjs`.
6. **A no-op write does not commit.** `issues assign` to the current assignee adds no commit.
7. **Literal paths.** `docs create 'notes/[x].md'` commits that file and nothing else.
8. **Migrate keeps outside changes out.** With `auto_commit: true` and a staged file outside the tracker, `migrate` commits only tracker files and the outside file stays staged.

The existing test `auto_commit commits only the tracker folder with pmkit: <op> <id>` keeps passing; its name can change to say "only the files the write changed".

## Decisions

| # | Decision | Reason |
|---|---|---|
| 1 | Approach A: the tracker records the files it writes and the CLI commits those paths only. | It is the only option that is exact without a git call before the write, and it is what the design spec describes ("`git add` on the changed paths"). C locks the user out after one failed commit; B costs git calls on every write and guesses from hashes. |
| 2 | Commit with explicit paths (`git commit -- <paths>`) after `git add -- <paths>`. | A path-limited commit leaves every other staged entry in the index, so staged code and staged tracker files the write did not touch stay staged. The existing test already relies on this for files outside the tracker. |
| 3 | When the write changes a file that already had uncommitted edits, the commit holds the whole file. | Git commits files. The usual case is a hand edit to `issue.md`, and the write's drift check appends synthetic events for that edit to `events.jsonl`, so committing the edit with its events keeps the history consistent. Splitting hunks would need `git apply --cached` and could commit a file whose events disagree with it. |
| 4 | `init` never commits, even with `--update` on a config that has `auto_commit: true`. | It writes `.pmkit/config.yaml`, outside the tracker, and runs before a config exists. `/pmkit:setup` shows its diff and leaves the commit to the user, which the design spec's anti-goal on commits asks for. |
| 5 | `migrate` keeps committing the tracker folder as one path, through the shared commit helper. | It already refuses with `CONFLICT` when the tracker folder has uncommitted changes, so the folder holds only its own changes. Its files come from `applyMigration`, not the tracker, and include deletes, which the folder pathspec stages without a per-file list. |
| 6 | A write that records no file, or whose staged diff is empty, makes no commit and is not an error. | The criterion asks for one commit per write that changes files. An empty commit would add noise to the history. Today's code already skips an empty diff. |
| 7 | Keep the message `pmkit: <command> <commit>` and the `UPSTREAM` failure with the written result. | Both match the design spec and are tested. The next step names the files instead of the folder, so the user commits the right ones. |
| 8 | Pass `--literal-pathspecs` to every git call of the commit. | `docs create` takes a user path, and `*`, `?` or `[` in it would be read as a glob and could match other files. |
| 9 | No change to the tracker format, no ADR. | The files keep their shape. ADR 0001 already says the plugin commits only when `auto_commit` is on, and this change keeps that. |

## Acceptance criteria

| Criterion | State before this work | Part of the design | Tests |
|---|---|---|---|
| With `auto_commit: true`, each write makes one commit with only the tracker files it changed | Partial. One commit per write and the message work, and files outside the tracker stay out. Every other change under the tracker folder is swept into the commit. | "Recording written files", "Committing", decisions 1, 2, 3, 6 | New tests 1, 2, 3, 6, 7, 8. Existing: `auto_commit commits only the tracker folder with pmkit: <op> <id>`, `pr sync commits with the moved ids when auto_commit is on`, `migrate with auto_commit commits once with its own message` |
| With `auto_commit: false`, the default, no command commits | Done in code: the template sets `false`, the guard compares with `=== true`, `init` and `pr *` never commit. Tested only for `migrate` (`migrate writes what the dry run listed`). | Guard in `run()` unchanged, decision 4 | New test 4 |
| A `--dry-run` never commits | Done in code: one guard in `run()`, and `runMigrate` returns before its commit on a dry run. Tested for `issues move` only (in `auto_commit commits only the tracker folder ...`). | Guard in `run()` unchanged; the recorder stays empty on a dry run | New test 5 |

## Left to the builder

- How the recorder is wired into `tracker.mjs`, `store.mjs`, `events.mjs` and `documents.mjs`.
- Whether the path list goes to git as arguments or through `--pathspec-from-file`.
- The exact wording of the README sentence, the template comment and the changelog entry.
- The test fixture and helper shape, reusing `makeRepo`, `hashTree` and the git setup already in `cli.test.mjs` and `cli-pr.test.mjs`.
