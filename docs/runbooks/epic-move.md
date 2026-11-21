# Runbook: move an epic

The flow of `/pmkit:issues:move` (`commands/issues/move.md`) when the ID is an epic, on a Local tracker: `epic move` changes the status category of an epic, warns when the epic still has open issues, and writes the move to the epic's event log. The confirmation of the command needs a person, so `scripts/runbook-epic-move.test.mjs` runs the CLI calls that the command makes, in the order of its steps: the dry run, then the real run after the approval. `npm test` checks this runbook. The GitHub flow is in `docs/runbooks/cycles-epics-github.md`.

## Before you start

- `/pmkit:setup` ran on this repository with the Local tracker, so `.pmkit/config.yaml` and `.issues/config.yaml` exist.
- Titles go through files, as `skills/pmkit/references/conventions.md` requires. The command writes them as temporary files outside `.issues/` with the file tool. The steps below use these:
  - `tmp/epic-title.txt`: `Release 2`
  - `tmp/title-open.txt` and `tmp/title-done.txt`: `Write the notes` and `Tag the build`
- The epic has two issues. `Tag the build` is in the `done` category and `Write the notes` is still open:

  ```
  node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --json
  node scripts/pmkit.mjs issues create --title-file tmp/title-open.txt --parent <epic-id> --json
  node scripts/pmkit.mjs issues create --title-file tmp/title-done.txt --parent <epic-id> --json
  node scripts/pmkit.mjs issues move <done-issue-id> done --json
  ```

  The new epic is in `backlog`. The steps call the epic `<epic-id>`, such as `EPC-M0GZ`, and the open issue `<open-issue-id>`.

## Move to done

1. The command shows the move before it writes anything. Run it as a dry run:

   ```
   node scripts/pmkit.mjs epic move <epic-id> done --dry-run --json
   ```

   Expect exit code 0, `before.status` `{ name: "backlog", category: "backlog" }` and `after.status` `{ name: "done", category: "done" }`. The standard error holds the warning `warning: <epic-id> still has open issues: <open-issue-id>`. It lists the issues that are not in the `done` or `canceled` category and are not archived, so the done issue is not in it. The dry run writes nothing under `.issues/`. The command shows `before`, `after` and the warning, and asks once.

2. After the approval, the command runs the same call without `--dry-run`:

   ```
   node scripts/pmkit.mjs epic move <epic-id> done --json
   node scripts/pmkit.mjs epic get <epic-id> --json
   node scripts/pmkit.mjs epic list --json
   ```

   Expect the same `before`, `after` and warning as in step 1. A warning never blocks the move. `epic get` and the row of the epic in `epic list` show `status` `{ name: "done", category: "done" }`. The last line of `.issues/epics/<epic-id>/events.jsonl` is the move, with `by` the actor and `at` the time:

   ```json
   {"at":"2026-10-23T12:00:00Z","by":"fred","op":"move","field":"status","from":"backlog","to":"done"}
   ```

3. Move the epic to the category it already has:

   ```
   node scripts/pmkit.mjs epic move <epic-id> done --json
   ```

   The command exits with code 2 and `INVALID_INPUT`, `epic <epic-id> is already in done`. The warning does not show and nothing is written. The command says so and changes nothing.

4. Name the status the epic already has:

   ```
   node scripts/pmkit.mjs epic move <epic-id> done --status done --json
   ```

   The command exits with code 2 and `INVALID_INPUT`, `epic <epic-id> is already in status done`. A Local tracker with two statuses in the `done` category moves between them with `--status`.

## Move to canceled

5. The warning shows on a move to `canceled` too:

   ```
   node scripts/pmkit.mjs epic move <epic-id> canceled --json
   ```

   Expect exit code 0, `after.status` `{ name: "canceled", category: "canceled" }` and the warning `warning: <epic-id> still has open issues: <open-issue-id>` on the standard error. A move to a category before `done`, such as `in_progress`, gives no warning.

## Errors

6. An epic that does not exist:

   ```
   node scripts/pmkit.mjs epic move EPC-ZZZZ done --json
   ```

   The command exits with code 2 and `NOT_FOUND`, `epic EPC-ZZZZ does not exist`, with the next step `pmkit epic list`.

7. A category that does not exist:

   ```
   node scripts/pmkit.mjs epic move <epic-id> later --json
   ```

   The command exits with code 2 and `INVALID_INPUT`, `category must be one of triage, backlog, todo, in_progress, in_review, done, canceled`.

8. A status that is not in the category:

   ```
   node scripts/pmkit.mjs epic move <epic-id> todo --status nope --json
   ```

   The command exits with code 2 and `INVALID_INPUT`, `status nope is not in category todo`, with the next step `Use one of: todo`.

## From the command file

9. The user gave an epic ID to `/pmkit:issues:move`. The command file reads the ID as an issue first, then as an epic, so run the two calls it makes:

   ```
   node scripts/pmkit.mjs issues get <epic-id> --json
   node scripts/pmkit.mjs epic get <epic-id> --json
   ```

   The first call exits with code 2 and `NOT_FOUND`, `issue <epic-id> does not exist`. The command file falls back on `NOT_FOUND` or `INVALID_INPUT`. The second call finds the epic and returns it with its `id` `<epic-id>`, so the command follows the epic path with `epic move`, as in steps 1 and 2.

## What the test checks

The test runs every call above on a copy of the `basic` fixture, with the real CLI as a subprocess. It checks that the dry run of step 1 writes nothing and carries the warning, that the move of step 2 shows `done` in `epic get` and `epic list` and appends the move to `events.jsonl` with `by` and `at`, and that the refusals of steps 3, 4 and 6 to 9 leave the files as they were. It checks that the warning of steps 1, 2 and 5 names the open issue and not the done one.
