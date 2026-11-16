# Runbook: issue flows on GitHub Issues

The issue commands on a repository whose tracker is GitHub Issues: create, list, move, link, parent, duplicate, comment, history, branch and archive. `scripts/runbook-issues-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`. The fake keeps the state of GitHub in a file between runs, so `npm test` checks this runbook.

## Before you start

- `/pmkit:setup` ran on this repository, as `docs/runbooks/setup-github.md` describes. `.pmkit/config.yaml` names the Project `acme/7`, maps `backlog`, `todo`, `in_progress`, `in_review` and `done` to its Status options, and maps the type `bug` to the issue type Bug.
- `gh` is logged in to the host of the repository, with the `project` scope.
- The local `main` holds every commit of `origin/main`, and `main` is the head of `main` on GitHub.
- Titles, criteria and comments go through files, as `skills/pmkit/references/conventions.md` requires. The steps write them in `tmp/` with the file tool:
  - `tmp/title-1.txt`: `Login fails on Safari`
  - `tmp/criteria-1.txt`: two lines, `- Login works on Safari 17` and `- A test covers the Safari login`
  - `tmp/title-2.txt`: `Upgrade the session library`
  - `tmp/title-3.txt`: `Safari users cannot log in`
  - `tmp/comment-1.txt`: `Reproduced on Safari 17.2.`

## Create and list

1. Create the bug with its criteria, then the two other issues:

   ```
   node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type bug --criteria-file tmp/criteria-1.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-2.txt --json
   node scripts/pmkit.mjs issues create --title-file tmp/title-3.txt --json
   ```

   Expect `before: null` and the new issue in `after`, with ids `1`, `2` and `3`. An issue of the scope repository is its number alone. Issue 1 has `type: bug` and two `acceptanceCriteria`, none done. A new issue has no Project item yet, so its status reads `Open`, category `todo`.

2. List the issues:

   ```
   node scripts/pmkit.mjs issues list --json
   ```

   Expect issues `1`, `2` and `3`, oldest first, each in `todo`, and `hasMore: false`.

## Move

3. Move issue 1 to todo, then to in progress:

   ```
   node scripts/pmkit.mjs issues move 1 todo --json
   node scripts/pmkit.mjs issues move 1 in_progress --json
   ```

   The first move adds the issue to the Project and sets its Status to `Todo`. The second sets `In Progress`, category `in_progress`. The issue stays open.

## Relations

4. Mark issue 2 as a blocker of issue 1, then list the blocked issues:

   ```
   node scripts/pmkit.mjs issues link 2 1 --kind blocks --json
   node scripts/pmkit.mjs issues list --blocked --json
   ```

   Expect `after.blocks: ["1"]` on issue 2. The list holds issue 1 alone, with `blockedBy: ["2"]`.

5. Make issue 2 a sub-issue of issue 1:

   ```
   node scripts/pmkit.mjs issues parent 2 1 --json
   ```

   Expect `after.parent: "1"` on issue 2.

6. Mark issue 3 as a duplicate of issue 1:

   ```
   node scripts/pmkit.mjs issues link 3 1 --kind duplicate --json
   ```

   GitHub closes a duplicate. Expect `after.duplicateOf: ["1"]` on issue 3, its status `Closed as not planned`, category `canceled`, and the note `GitHub closed 3 as a duplicate of 1`.

## Comment

7. Comment on issue 1:

   ```
   node scripts/pmkit.mjs issues comment 1 --body-file tmp/comment-1.txt --json
   ```

   Expect the comment with `issue: "1"`, the `author` of the `gh` login and the text of the file as `body`. GitHub issue comments are flat, so `--reply-to` answers `NOT_SUPPORTED`.

## Branch

8. Preview the branch of issue 1, then create it:

   ```
   node scripts/pmkit.mjs issues branch 1 --dry-run --json
   node scripts/pmkit.mjs issues branch 1 --json
   ```

   The dry run gives `branch: "1-login-fails-on-safari"`, the name `gh issue develop` uses, and `from: "main"`, and writes nothing. The real run creates the linked branch on GitHub at the head there of `main`, the branch it starts from, then creates and checks out the local branch. Expect `after.branch` and `linked: { branch, base: "main" }`. GitHub lists the branch in the Development section of the issue, and `issues get 1 --json` reads it as `branch`. With `main` level with `origin/main`, neither run has a note about the push.

9. When the local `main` lacks commits of `origin/main` (as of the last fetch), the branch on GitHub starts at a commit the local branch does not hold, and GitHub would refuse the push of `pr open` as non-fast-forward. Both runs then carry a note. The dry run says:

   ```
   GitHub creates 1-login-fails-on-safari on origin at the head of main there, and main lacks commits of origin/main (as of the last fetch), so the push of pr open would be refused. Pass --from origin/main
   ```

   The real run ends with `Run git fetch origin, then git rebase --onto origin/main main 1-login-fails-on-safari` instead. To start the branch at the head of `origin/main` from the beginning, pass `--from`:

   ```
   node scripts/pmkit.mjs issues branch 1 --from origin/main --json
   ```

   Expect `from: "origin/main"`, the link at the head of `main` on GitHub, and no note about the push.

## Close, history and archive

10. Move issue 1 to done:

    ```
    node scripts/pmkit.mjs issues move 1 done --json
    ```

    Expect `Done`, category `done`. GitHub closes the issue as completed.

11. Read the history of issue 1:

    ```
    node scripts/pmkit.mjs issues get 1 --history --json
    ```

    Expect `history` in time order: `create`, the type set to `bug`, the moves to `Todo`, `In Progress` and `Done`, the `blockedBy` link to `2`, the `children` link to `2` and the `comment`. On GitHub Enterprise Server before 3.21, Status option changes have no events, so the command warns that moves show only as opens and closes.

12. Archive issue 1:

    ```
    node scripts/pmkit.mjs issues archive 1 --json
    node scripts/pmkit.mjs issues list --json
    node scripts/pmkit.mjs issues list --archived --json
    ```

    `archive` archives the item of the issue in the Project, and the issue stays open or closed as it was. Expect `after.archived: true`. `issues list` leaves issue 1 out. `issues list --archived` also lists archived issues, so it holds issues 1, 2 and 3, with `archived: true` on issue 1 alone. A repository with `tracker.scope.project: none` has no item to archive, so `archive` answers `NOT_SUPPORTED`.

13. Try to unarchive it:

    ```
    node scripts/pmkit.mjs issues unarchive 1 --json
    ```

    The command exits with code 2 and `NOT_SUPPORTED`, with the next step `Restore the item from the archived items of the Project on GitHub`. ADR 0008 records why.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname github.com`.
