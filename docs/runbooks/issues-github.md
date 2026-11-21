# Runbook: issue flows on GitHub Issues

The issue commands on a repository whose tracker is GitHub Issues: create, list, move, update, assign, link and unlink, parent, duplicate, comment, history, branch and archive, then the same flows on a repository without a Project. `scripts/runbook-issues-github.test.mjs` runs every step below with the real CLI and a fake `gh` first on `PATH`. The fake keeps the state of GitHub in a file between runs, so `npm test` checks this runbook.

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

   Expect `before: null` and the new issue in `after`, with ids `1`, `2` and `3`. An issue of the scope repository is its number alone. Issue 1 has `type: bug` and two `acceptanceCriteria`, none done. pmkit adds each new issue to the Project with no Status, so its status reads `Open`, category `todo`.

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

   The first move sets the Status of the issue's Project item to `Todo`. The second sets `In Progress`, category `in_progress`. The issue stays open.

## Update and assign

4. Set the priority and a label of issue 2:

   ```
   node scripts/pmkit.mjs issues update 2 --priority high --label bug --json
   ```

   Expect `after.priority: "high"` and `after.labels: ["bug"]`. The mapped issue field `Priority` has two options, `P0` and `P1`. Neither is named after a priority, so they map by position, and `high` writes `P1`.

5. Assign issue 2 to yourself, then remove the assignee:

   ```
   node scripts/pmkit.mjs issues assign 2 me --json
   node scripts/pmkit.mjs issues assign 2 none --json
   ```

   `me` stands for the `gh` login, so the first command gives `after.assignee` that login. `none` removes every assignee on GitHub, so the second gives an `after` with no `assignee`.

## Relations

6. Mark issue 2 as a blocker of issue 1, then list the blocked issues:

   ```
   node scripts/pmkit.mjs issues link 2 1 --kind blocks --json
   node scripts/pmkit.mjs issues list --blocked --json
   ```

   Expect `after.blocks: ["1"]` on issue 2. The list holds issue 1 alone, with `blockedBy: ["2"]`.

7. Remove the blocker:

   ```
   node scripts/pmkit.mjs issues link 2 1 --kind blocks --remove --json
   node scripts/pmkit.mjs issues get 1 --json
   ```

   Expect `after.blocks: []` on issue 2. `issues get 1` shows `blockedBy: []`.

8. Make issue 2 a sub-issue of issue 1:

   ```
   node scripts/pmkit.mjs issues parent 2 1 --json
   ```

   Expect `after.parent: "1"` on issue 2.

9. Mark issue 3 as a duplicate of issue 1:

   ```
   node scripts/pmkit.mjs issues link 3 1 --kind duplicate --json
   ```

   GitHub closes a duplicate. Expect `after.duplicateOf: ["1"]` on issue 3, its status `Closed as not planned`, category `canceled`, and the note `GitHub closed 3 as a duplicate of 1`.

## Comment

10. Comment on issue 1:

    ```
    node scripts/pmkit.mjs issues comment 1 --body-file tmp/comment-1.txt --json
    ```

    Expect the comment with `issue: "1"`, the `author` of the `gh` login and the text of the file as `body`. GitHub issue comments are flat, so `--reply-to` answers `NOT_SUPPORTED`.

## Branch

11. Preview the branch of issue 1, then create it:

    ```
    node scripts/pmkit.mjs issues branch 1 --dry-run --json
    node scripts/pmkit.mjs issues branch 1 --json
    ```

    The dry run gives `branch: "1-login-fails-on-safari"`, the name `gh issue develop` uses, and `from: "main"`, and writes nothing. The real run creates the linked branch on GitHub at the head there of `main`, the branch it starts from, then creates and checks out the local branch. Expect `after.branch` and `linked: { branch, base: "main" }`. GitHub lists the branch in the Development section of the issue, and `issues get 1 --json` reads it as `branch`. With `main` level with `origin/main`, neither run has a note about the push.

12. When the local `main` lacks commits of `origin/main` (as of the last fetch), the branch on GitHub starts at a commit the local branch does not hold, and GitHub would refuse the push of `pr open` as non-fast-forward. Both runs then carry a note. The dry run says:

    ```
    GitHub creates 1-login-fails-on-safari on origin at the head of main there, and main lacks commits of origin/main (as of the last fetch), so the push of pr open would be refused. Pass --from origin/main
    ```

    The real run ends with `Run git fetch origin, then git rebase --onto origin/main main 1-login-fails-on-safari` instead. To start the branch at the head of `origin/main` from the beginning, pass `--from`:

    ```
    node scripts/pmkit.mjs issues branch 1 --from origin/main --json
    ```

    Expect `from: "origin/main"`, the link at the head of `main` on GitHub, and no note about the push.

## Close, history and archive

13. Move issue 1 to done:

    ```
    node scripts/pmkit.mjs issues move 1 done --json
    ```

    Expect `Done`, category `done`. GitHub closes the issue as completed.

14. Read the history of issue 1:

    ```
    node scripts/pmkit.mjs issues get 1 --history --json
    ```

    Expect `history` in time order: `create`, the type set to `bug`, the moves to `Todo`, `In Progress` and `Done`, the `blockedBy` link to `2` and its unlink, the `children` link to `2` and the `comment`. On GitHub Enterprise Server before 3.20, Status option changes have no events, so the command warns that moves show only as opens and closes.

15. Archive issue 1:

    ```
    node scripts/pmkit.mjs issues archive 1 --json
    node scripts/pmkit.mjs issues list --json
    node scripts/pmkit.mjs issues list --archived --json
    ```

    `archive` archives the item of the issue in the Project, and the issue stays open or closed as it was. Expect `after.archived: true`. `issues list` leaves issue 1 out. `issues list --archived` also lists archived issues, so it holds issues 1, 2 and 3, with `archived: true` on issue 1 alone. A repository with `tracker.scope.project: none` has no item to archive, so `archive` answers `NOT_SUPPORTED` (step 23).

16. Try to unarchive it:

    ```
    node scripts/pmkit.mjs issues unarchive 1 --json
    ```

    The command exits with code 2 and `NOT_SUPPORTED`, with the next step `Restore the item from the archived items of the Project on GitHub`. ADR 0008 records why.

## Without a Project

These steps run on another repository: one with no Project and no enabled issue type. ADR 0009 records how pmkit reads statuses and types from labels there.

- `/pmkit:setup` ran with `--project none`, as the "Without a Project" section of `docs/runbooks/setup-github.md` describes. `.pmkit/config.yaml` maps `backlog` to `label:Backlog`, `in_progress` to `label:In progress`, `in_review` to `label:In review`, `triage` to `none`, and the type `bug` to `label:bug`.
- `gh` needs no `project` scope.
- `tmp/title-1.txt` holds `Login fails on Safari`.

17. Create the bug:

    ```
    node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type bug --json
    ```

    Expect issue `1` with `type: bug`, `labels: ["bug"]` and status `Open`, category `todo`. GitHub has the label `bug` on the issue.

18. Move issue 1 to in progress, then to in review:

    ```
    node scripts/pmkit.mjs issues move 1 in_progress --json
    node scripts/pmkit.mjs issues move 1 in_review --json
    ```

    The first move adds the label `In progress`, so the status reads `In progress`, category `in_progress`. The second adds `In review` and then removes `In progress`. Expect status `In review` and `labels: ["In review", "bug"]`.

19. Replace the other labels of issue 1:

    ```
    node scripts/pmkit.mjs issues update 1 --label documentation --json
    ```

    A labels patch changes only the labels that hold no status and no type. Expect `labels: ["In review", "bug", "documentation"]` and the status still `In review`. `--label "In review"` would fail with `INVALID_INPUT`, `label In review holds a status; use pmkit issues move`.

20. Move issue 1 to done:

    ```
    node scripts/pmkit.mjs issues move 1 done --json
    ```

    GitHub closes the issue as completed, and pmkit removes the status label. Expect status `Closed`, category `done`, and `labels: ["bug", "documentation"]`.

21. Read the history of issue 1:

    ```
    node scripts/pmkit.mjs issues get 1 --history --json
    ```

    Expect the type set to `bug`, then the moves from `Open` to `In progress`, from `In progress` to `In review`, and to `Closed`. A status label never shows as a label update.

22. Read the capabilities:

    ```
    node scripts/pmkit.mjs capabilities --json
    ```

    Expect `cycles`, `capacity`, `deliverables` and `status_update` with path `absent` and the hint `Needs a GitHub Project: set tracker.scope.project with /pmkit:setup`, `native_triage` absent with `Map a triage label with /pmkit:setup`, and the warning `tracker.scope.project is none, so cycles, capacity, deliverables and status_update are absent`.

23. Try to archive issue 1:

    ```
    node scripts/pmkit.mjs issues archive 1 --json
    ```

    The command exits with code 2 and `NOT_SUPPORTED`, `acme/widgets has no Project, and GitHub has no archive for an issue outside one`, with the next step `Close it with pmkit issues move 1 canceled, or set tracker.scope.project with /pmkit:setup`.

## Priority and estimate as labels

These steps run on a third repository: no Project, no enabled issue type, and no issue field, so no field can hold the priority or the estimate. ADR 0012 records how pmkit reads them from labels there.

- `/pmkit:setup` ran with `--project none` and every field role `none`, as the "Without a Project" section of `docs/runbooks/setup-github.md` describes, with `--priority-label urgent=P0 --priority-label high=P1 --priority-label medium=P2 --priority-label low=none` and `--estimate-label 1="size: 1" --estimate-label 3="size: 3" --estimate-label 5="size: 5"`.
- `tmp/title-1.txt` holds `Login fails on Safari`.

24. Create the bug with a priority and an estimate:

    ```
    node scripts/pmkit.mjs issues create --title-file tmp/title-1.txt --type bug --priority high --estimate 3 --json
    ```

    Expect `priority: high`, `estimate: 3` and `labels: ["P1", "bug", "size: 3"]`. GitHub has those three labels on the issue. `discover` reports the estimate as `{ unit: points, scale: [1, 3, 5] }`: the keys of `mappings.estimate`, in points because each is a number.

25. Raise the priority and clear the estimate:

    ```
    node scripts/pmkit.mjs issues update 1 --priority urgent --estimate none --json
    ```

    pmkit swaps `P1` for `P0` and removes `size: 3`, in one labels update and no field write. Expect `priority: urgent`, no `estimate`, and `labels: ["P0", "bug"]`.

26. A priority or estimate label is not a plain label, and a value needs a label:

    `issues update 1 --label P1` fails with `INVALID_INPUT`, `label P1 holds a priority; use --priority`. `issues update 1 --priority low` fails with `INVALID_INPUT`, `priority low has no label in mappings.priority (urgent, high, medium)`, with the next step `/pmkit:setup`. An issue with two priority labels reads the higher one, with a warning that names both.

## What the fake `gh` checks

The test records every `gh` call and fails when an argument or the standard input holds the token in `GH_TOKEN`. Every call carries `--hostname github.com`.
