# Runbook: edit an epic's title and description

`epic update` changes the title or the description of an existing epic, and writes each change to the epic's event log, on a Local tracker. `scripts/runbook-epic-update.test.mjs` runs the CLI calls below, in order, and `npm test` checks this runbook. The command takes the same text files as `epic create`. On Linear it edits the project's name and content, and on GitHub the Project's title and readme. The contract suite checks both over their fakes, and the live Linear run checks Linear.

## Before you start

- `/pmkit:setup` ran on this repository with the Local tracker.
- The text goes through files, as `skills/pmkit/references/conventions.md` requires:
  - `tmp/epic-title.txt`: `Release 2`
  - `tmp/description.md`: `Ship the second release to every customer.`
  - `tmp/new-title.txt`: `Release 2.0`
- The epic exists, with no description:

  ```
  node scripts/pmkit.mjs epic create --title-file tmp/epic-title.txt --json
  ```

  The steps call it `<epic-id>`, such as `EPC-M0GZ`.

## Set the description

1. Preview the change:

   ```
   node scripts/pmkit.mjs epic update <epic-id> --description-file tmp/description.md --dry-run --json
   ```

   Expect exit code 0, `before.description` `""` and `after.description` `Ship the second release to every customer.` The dry run writes nothing under `.issues/`.

2. Run it:

   ```
   node scripts/pmkit.mjs epic update <epic-id> --description-file tmp/description.md --json
   node scripts/pmkit.mjs epic get <epic-id> --json
   ```

   `epic get` shows the new `description` and the same `title`. The last line of `.issues/epics/<epic-id>/events.jsonl` is the edit, with `by` the actor and `at` the time:

   ```json
   {"at":"2026-10-23T12:00:00Z","by":"fred","op":"update","field":"description","from":"","to":"Ship the second release to every customer."}
   ```

## Change the title

3. Run:

   ```
   node scripts/pmkit.mjs epic update <epic-id> --title-file tmp/new-title.txt --json
   node scripts/pmkit.mjs epic get <epic-id> --json
   ```

   `epic get` shows `title` `Release 2.0` and keeps the description of step 2. The event log gains an `update` line with `field` `title`, `from` `Release 2` and `to` `Release 2.0`.

## Refusals

4. Run the same title again:

   ```
   node scripts/pmkit.mjs epic update <epic-id> --title-file tmp/new-title.txt --json
   ```

   Expect exit code 2 and `error.code` `INVALID_INPUT`: the epic already has this title and description. Nothing is written.

5. Run it with no change at all:

   ```
   node scripts/pmkit.mjs epic update <epic-id> --json
   ```

   Expect exit code 2 and `error.code` `INVALID_INPUT`, with the usage in the next step.

6. Run it on an epic that does not exist:

   ```
   node scripts/pmkit.mjs epic update EPC-ZZZZ --title-file tmp/new-title.txt --json
   ```

   Expect exit code 2 and `error.code` `NOT_FOUND`.
