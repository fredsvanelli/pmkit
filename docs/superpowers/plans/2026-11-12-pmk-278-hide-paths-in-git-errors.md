# PMK-278 Hide absolute paths in git errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every message that repeats git's stderr passes it through `hideAbsolutePaths`.

**Architecture:** Wrap the git-derived text at each of the six places in the spec, not the whole message. `hideAbsolutePaths` and `relativeTo` are untouched.

**Tech Stack:** Node ESM, `node:test`, `node scripts/pmkit.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-12-pmk-278-hide-paths-in-git-errors-design.md`

## Global Constraints

- Do not change the regex or the signature of `hideAbsolutePaths` (PMK-277 changes it in parallel).
- The `auto_commit` message of PMK-271 keeps its text.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; the issue ID `PMK-278` in every message.

## Review Focus

- A path with a space in git's stderr hides whole (`/Users/John Doe/x`).
- A pmkit-worded reason ("not a git repository", "git is not installed") stays as it is.
- A path the user typed (`--path`, the folder in `cannot list the files of <root>`) stays.
- `pr open` still reads the HTTP status from the raw line of a `gh` failure.
- The `auto_commit` failure text is the same as before.

## Places that repeat git's stderr

1. `scripts/pmkit.mjs:493` `grepFailure` 2. `:2373` `tagWarning` 3. `:3801` `readRemotes` 4. `scripts/lib/todos.mjs:450` `scanRepo` 5. `scripts/lib/local/tracker.mjs:1002,1004,1012` (the inbox note) 6. `scripts/lib/github/host.mjs:40` `failure`, for `git` calls only. `commitIn` (`pmkit.mjs:4215`) already does it.

### Task 1: CLI messages (items 1 to 4)

**Files:** Modify `scripts/pmkit.mjs`, `scripts/lib/todos.mjs`; Test `scripts/cli-git-paths.test.mjs` (new).

**Interfaces:** Consumes `hideAbsolutePaths(text: string): string` from `scripts/lib/paths.mjs`. Produces nothing new.

- [ ] **Step 1: Failing tests.** `todos scan` through the CLI with `GIT_DIR=<tmp>/no such dir` in the env: stderr has `<path>`, not the temp folder, and still names the `--root` folder the command repeats. `issues delete --dry-run` of an issue in a repo with `GIT_DIR` set the same way: `unchecked` has `git grep failed: ...<path>` and no temp folder. `tagWarning(root, 'v1', { ...process.env, GIT_DIR: '<tmp>/no such dir' })` has no temp folder.
- [ ] **Step 2: Run** `node --test scripts/cli-git-paths.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Wrap** the git text with `hideAbsolutePaths` in `grepFailure` (the first-line return), `tagWarning` (`first`), `readRemotes` (`reason`), and `scanRepo` (`stderr || ...` branch of `why`). Keep the `not a git repository` shortcuts first.
- [ ] **Step 4: Run** the new test plus `node --test scripts/cli-delete.test.mjs scripts/cli-todos.test.mjs scripts/cli.test.mjs scripts/cli-link-repo.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(git): hide absolute paths in the git errors of delete, todos, tags and link-repo (PMK-278)`.

### Task 2: Inbox note and host failure (items 5 and 6)

**Files:** Modify `scripts/lib/local/tracker.mjs`, `scripts/lib/github/host.mjs`; Test `scripts/github-host.test.mjs`, `scripts/inbox-tracker.test.mjs` (or `scripts/cli-git-paths.test.mjs`).

- [ ] **Step 1: Failing tests.** `failure('git', ['push','-u','origin','b'], { status: 1, stderr: "fatal: '/Users/John Doe/r.git' does not appear to be a git repository\n" })` message has `<path>` and no `/Users`; a `gh` failure keeps its text; `httpStatus` still parses for `gh`. The inbox prune note, forced by a git read failure on a missing repo path through `GIT_DIR`, has no absolute path.
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: In `failure`**, hide `detail` in the message only when `cmd === 'git'`; keep the raw `detail` for the HTTP match. In `branchReader` and its note, wrap the first line of the message with `hideAbsolutePaths`.
- [ ] **Step 4: Run** `node --test scripts/github-host.test.mjs scripts/inbox-tracker.test.mjs scripts/cli-pr.test.mjs scripts/cli-inbox.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(git): hide absolute paths in the git errors of pr and inbox (PMK-278)`.

### Task 3: auto_commit unchanged, changelog, delivery

**Files:** Modify `CHANGELOG.md`; existing `scripts/cli-autocommit.test.mjs` is the guard.

- [ ] **Step 1: Run** `node --test scripts/cli-autocommit.test.mjs scripts/paths.test.mjs`. Expected: PASS, no edits to them.
- [ ] **Step 2: Add** one line at the top of `## Unreleased` in `CHANGELOG.md` for PMK-278.
- [ ] **Step 3: Check** both acceptance criteria with `issues update PMK-278 --check 1` and `--check 2` (dry-run, then real); commit `.issues/`.
- [ ] **Step 4: Run** `npm test` in the foreground; expected exit code 0.
- [ ] **Step 5: Deliver** with `pr open`, the summary comment and `in_review`.
