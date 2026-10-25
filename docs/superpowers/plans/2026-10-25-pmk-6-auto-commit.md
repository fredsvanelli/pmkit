# PMK-6 auto_commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `auto_commit: true`, each tracker write makes one commit that holds only the files that write changed.

**Architecture:** The Local tracker records every file it writes. `run()` in `scripts/pmkit.mjs` passes that list to `commitTracker`, which runs `git add` and `git commit` on those paths only. `migrate` keeps its own commit and passes the tracker folder as its one path.

**Tech Stack:** Node (ESM, no dependencies, ADR 0003), `node:test`, git.

**Spec:** `docs/superpowers/specs/2026-10-25-pmk-6-auto-commit-design.md`

## Global Constraints

- Commit message of an auto-commit: `pmkit: <command> <commit>`, where `<command>` is `command.name` and `<commit>` is `result.commit`. `migrate` uses `pmkit: migrate tracker format <from> to <to>`. Do not change either.
- Commit only when `command.write`, not `--dry-run`, `result.commit !== undefined` and `config.local.auto_commit === true`. Keep this guard in `run()` as it is.
- Git calls, all with `cwd` set to the project root and the flag `--literal-pathspecs` before the subcommand: `git --literal-pathspecs add -- <paths>`, then `git --literal-pathspecs diff --cached --quiet -- <paths>` (status 0 means no commit), then `git --literal-pathspecs commit -m <message> -- <paths>`.
- Paths are relative to the project root, use `/` separators and are sorted. `writtenFiles()` returns them.
- An empty `writtenFiles()` or an empty staged diff means no commit and no error.
- Failure: `PmkitError('UPSTREAM', 'the write succeeded but auto_commit failed: <git output>', 'Commit <paths> yourself')`. The next step names the files when there are 5 or fewer, otherwise the tracker folder. The written result stays in `error.written`. Exit code 2.
- `init`, `pr open` and `pr ready` never commit. No ADR and no tracker format change.
- Commit trailer: every commit ends with `Co-Authored-By: Claude <model of the implementer> <noreply@anthropic.com>`, naming the model that made the commit (for example `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Every commit message carries `(PMK-6)`.
- Test commands: `npm test` or `node --test scripts/<file>.test.mjs`. Tests that create git repositories remove their temp directory at the end of each test, in a `finally` block (PMK-111 tracks the existing leaks; do not add to them). Set `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` as `scripts/cli.test.mjs` does.

## Review Focus

- A hand edit to another issue's `issue.md`, an untracked and a staged file under `.issues/docs/`, and a staged file outside the tracker all survive an `issues assign` with the same staged state (Task 1, test 1).
- `issues link --kind related` and `cycle add` on several issues make exactly one commit that holds every file they touched (Task 1, test 2).
- A no-op write (assign the current assignee) makes no commit and no error (Task 1, test 3).
- `docs create 'notes/[x].md'` commits that file only; the brackets are not a glob (Task 1, test 4).
- A write site that skips the recorder leaves a file uncommitted, and the matrix test in Task 2 fails (Task 2, mutation check).
- `migrate` with a staged outside file commits tracker files only (Task 2).
- A rejected commit (pre-commit hook) still exits 2 with the written result (existing test must keep passing).

---

### Task 1: Record written files and commit only those paths

Complexity: hard
Covers: "With `auto_commit: true`, each write makes one commit with only the tracker files it changed"

**Files:**
- Create: `scripts/cli-autocommit.test.mjs`
- Modify: `scripts/lib/local/tracker.mjs` (every `writeFileAtomic` and `appendEvents` call site, lines ~244, 245, 261, 266, 581, 617, 729, 730, 775, 795), `scripts/lib/local/documents.mjs` (`createDocumentFile`), `scripts/pmkit.mjs` (`commitTracker`, `run()`, `runMigrate`)

**Interfaces:**
- Produces: `tracker.writtenFiles(): string[]` (root-relative, `/` separators, sorted, no duplicates).
- Produces: `createDocumentFile(docsDir, docPath, body, { dryRun, onWrite })` where `onWrite(absoluteFile)` is called after the file is written.
- Produces: `commitTracker(config, message, paths: string[])` in `scripts/pmkit.mjs`.

- [ ] **Step 1: Write the failing tests** in `scripts/cli-autocommit.test.mjs`. Add helpers: `run(cwd, args)` and `git(cwd, ...args)` copied from `scripts/cli.test.mjs`, and `withRepo(fixture, { autoCommit }, fn)` that builds `makeRepo(fixture)`, sets `auto_commit` in `.issues/config.yaml`, runs `git init`, sets `user.name` and `user.email`, commits everything, calls `fn(root)` and removes `root` with `fs.rmSync(root, { recursive: true, force: true })` in `finally`. Use the `team` fixture (it has `ISS-0G5E` and `ISS-1V9Z`; check `scripts/__fixtures__/team` for a sprint id and members). Tests:
  1. `commits only the files the write changed`: hand edit `ISS-1V9Z/issue.md`, untracked `.issues/docs/draft.md`, staged `.issues/docs/staged.md`, staged `outside.txt`. Run `issues assign ISS-0G5E ana`. Assert `git rev-list --count HEAD` grew by 1, `git show --name-only --format= HEAD` equals exactly `.issues/issues/ISS-0G5E/events.jsonl` and `.issues/issues/ISS-0G5E/issue.md`, and `git status --porcelain` is `' M .issues/issues/ISS-1V9Z/issue.md'`, `'?? .issues/docs/draft.md'`, `'A  .issues/docs/staged.md'`, `'A  outside.txt'` (compare as a sorted array).
  2. `one commit for a write that touches several files`: `issues link ISS-0G5E ISS-1V9Z --kind related` and `cycle add` with two issues to an existing sprint. Each adds exactly one commit and the commit holds every touched file; the tree under `.issues` is clean afterwards.
  3. `a write that changes nothing does not commit`: assign the current assignee, HEAD unchanged, exit 0.
  4. `docs create with brackets commits that file only`: `docs create 'notes/[x].md' --body hello` with another untracked file `.issues/docs/notes/a.md` present. The commit holds only `.issues/docs/notes/[x].md`.
  5. Add a unit test in `scripts/tracker-issues.test.mjs`: after one `create`, `tracker.writtenFiles()` lists the issue's `issue.md` and `events.jsonl`; after a dry-run create it is `[]`.

- [ ] **Step 2: Run to verify failure.** Run: `node --test scripts/cli-autocommit.test.mjs scripts/tracker-issues.test.mjs`. Expected: tests 1, 2, 4 and 5 FAIL (test 3 may pass already).

- [ ] **Step 3: Implement the recorder** in `createLocalTracker`: a `Set` of absolute paths, a local `writeFile(file, text)` that calls `writeFileAtomic` then adds the file, and a local `append(file, events)` that calls `appendEvents` and adds the file only when `events.length > 0`. Replace every direct call in `tracker.mjs` with these. Pass `onWrite: (file) => written.add(file)` to `createDocumentFile`, which calls it after `writeFileAtomic`. Add `writtenFiles()` to the returned object, mapping through `path.relative(config.root, file)` with `/` separators, sorted. Check that no write site remains: `grep -n "writeFileAtomic\|appendEvents" scripts/lib/local/tracker.mjs` must show only the imports and the two wrappers.

- [ ] **Step 4: Implement the commit.** Change `commitTracker(config, message, paths)` to run the three git calls from Global Constraints and build the failure next step as specified. In `run()`, read the paths from the tracker only if `tracker` was created (`tracker?.writtenFiles() ?? []`) and skip the commit when empty. In `runMigrate`, call `commitTracker(migrated, message, [trackerPath])`, so the folder is the one path.

- [ ] **Step 5: Run the tests.** Run: `npm test`. Expected: all PASS, including `auto_commit commits only the tracker folder with pmkit: <op> <id>`, `a failing auto_commit exits 2 ...` and the `migrate` and `pr sync` auto-commit tests.

- [ ] **Step 6: Commit** `feat: commit only the files each write changed (PMK-6)` with the trailer from Global Constraints.

### Task 2: Pin the three acceptance criteria across every write command

Complexity: standard
Covers: "With `auto_commit: false`, the default, no command commits"; "A `--dry-run` never commits"; "With `auto_commit: true`, each write makes one commit with only the tracker files it changed" (every command)

**Files:**
- Modify: `scripts/cli-autocommit.test.mjs`, `scripts/cli-pr.test.mjs`, `scripts/migrations.test.mjs`

**Interfaces:**
- Consumes: `withRepo`, `run`, `git` from Task 1.

- [ ] **Step 1: Write the tests.** In `cli-autocommit.test.mjs` define `WRITES`, a table of `{ args, expectedMessage }` over every command with `write: true` that returns `commit`, except `pr *` and `migrate`: `issues create/update/move/assign/parent/archive/link/comment/log-time`, `cycle open/capacity/close/add`, `epic create/update-status`, `docs create`. Take ids from the `team` fixture; use `--as` for the actor if needed. Three tests iterate the table, each case in its own `withRepo`:
  - `auto_commit true: one commit per write, tracker clean afterwards`: HEAD grows by 1, subject is `pmkit: <command> <id>`, `git status --porcelain -- .issues` is empty.
  - `auto_commit false: no commit, files left uncommitted`: HEAD unchanged, `git status --porcelain -- .issues` not empty. Also one case without the key set to prove the default is `false`.
  - `--dry-run with auto_commit true: no commit, nothing written`: HEAD unchanged, `git status --porcelain` empty.
  Add `issues branch` for the commit and dry-run tests (it runs `git switch -c`; assert on the new branch). `issues branch` and `cycle close` may need fixture state; read the existing tests in `scripts/cli.test.mjs` and reuse their setup.
  In `cli-pr.test.mjs` add `pr sync --dry-run with auto_commit true does not commit` using the fake `gh` already there, and make sure the repo is removed in `finally`. In `migrations.test.mjs` add `migrate --dry-run with auto_commit true does not commit` and `migrate with auto_commit keeps a staged outside file staged and out of the commit` (assert `git status --porcelain` shows the file staged and `git show --name-only --format= HEAD` has tracker paths only).

- [ ] **Step 2: Run.** Run: `node --test scripts/cli-autocommit.test.mjs scripts/cli-pr.test.mjs scripts/migrations.test.mjs`. Expected: PASS at once, because Task 1 already implements the behavior. These tests pin it and have no red phase.

- [ ] **Step 3: Mutation check.** In `tracker.mjs`, temporarily make the `comment()` write bypass the recorder. Run the table test. Expected: the `issues comment` case FAILS. Revert the mutation and run `npm test`. Expected: PASS and `git diff` shows no change in `tracker.mjs`.

- [ ] **Step 4: Commit** `test: pin auto_commit behavior across every write command (PMK-6)` with the trailer.

### Task 3: Document auto_commit

Complexity: mechanical
Covers: "With `auto_commit: false`, the default, no command commits" (documents the default)

**Files:**
- Modify: `templates/issues.config.yaml` (comment above `auto_commit: false`), `README.md` (one sentence next to the command table)

- [ ] **Step 1:** Add the template comment: with `auto_commit: true` each pmkit write commits the files it changed as `pmkit: <command> <id>`; `false` commits nothing. Add the README sentence with the same facts and the note that `--dry-run` and `init` never commit. Do not edit `CHANGELOG.md` (written at delivery).
- [ ] **Step 2:** Run `npm test`. Expected: PASS. Template tests may compare the template with fixtures; fix any mismatch by updating the fixture comment, not the test.
- [ ] **Step 3: Commit** `docs: describe auto_commit in the template and README (PMK-6)` with the trailer.
