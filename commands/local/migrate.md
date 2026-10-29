---
description: Move the Local tracker to a Linear team, import a Linear team into .issues/, undo an export, or switch pmkit to the new tracker
argument-hint: "[export|import|undo|switch] [--workspace acme --team ACME]"
disable-model-invocation: true
---

# Migrate between the Local tracker and Linear

Arguments: `$ARGUMENTS`

## Parameters

- `direction` (required): `export` copies `.issues/` to a Linear team, `import` copies a Linear team into an empty `.issues/`, `undo` takes back the newest migration, and `switch` points pmkit at the tracker a finished migration filled. When it is missing, ask for it in step 2.
- `workspace` and `team` (optional): the Linear side, as `--workspace acme --team ACME`. Without them, the CLI takes `tracker.scope` from `.pmkit/config.yaml`.
- `path` (optional, import only): the Local tracker folder. Defaults to `.issues`.
- `file` (optional): the map under `.pmkit/migrations/` that `status`, `undo` and `switch` read. Defaults to the newest map.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Read the conventions, as the line above says.
2. Take the direction and the Linear workspace and team from the arguments or the request. When the direction is missing, ask with `AskUserQuestion` and offer export, import, undo and switch. For `undo`, go to step 11. For `switch`, go to step 9.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate status --json`. A `NOT_FOUND` means there is no map yet. When the newest map has the same direction and is not finished, show its counts and failures and ask with `AskUserQuestion` whether to resume it. Running the same command again resumes it.
4. Run the dry run. For an export: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate export [--workspace w --team T] [--status cat=Name] [--type-label type=Label] [--field estimate=native|none] --dry-run --json`. When it stops with `NOT_CONFIGURED` and `mappings` in the details, the export has open mapping questions: ask each one with `AskUserQuestion`, then run the dry run again with the answers as `--status`, `--type-label` or `--field`. For an import: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate import [--workspace w --team T] [--path .issues] --dry-run --json`.
5. When the dry run stops with `INVALID_INPUT` and `problems`, list every problem with its record ID and message, and stop. The user fixes them and runs the command again.
6. Show the preview from the dry run. Start with the summary table from `steps`, the request `budget` and the `people`, then every row of `losses` as "will not carry over", then one table per kind in `records`. A migration writes many records, so it always shows the full preview and asks with `AskUserQuestion`, whatever `write_policy.confirm` says. Name the `digest` in the question. When the user declines, stop and write nothing.
7. Run the same command with the digest. For an export: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate export [the same flags] --expect <digest> --json`. For an import: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate import [the same flags] --expect <digest> --json`. On `RATE_LIMITED` or a failed record, report `done` of `total`, the `map` path and the `next` step: the same command resumes after the reset time.
8. When `done` equals `total`, the map is finished. Tell the user to commit the map under `.pmkit/migrations/`, and after an import the new `.issues/` too. Then offer to switch pmkit to the new tracker.
9. Preview the switch with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate switch --to <linear|local> --dry-run --json`. The target is `linear` after an export and `local` after an import. Show its `diff` of `.pmkit/config.yaml`. When `changes` is empty, the config already names that tracker: say so, and stop.
10. Ask with `AskUserQuestion` whether to write them. When the user agrees, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate switch --to <linear|local> --json` and tell the user to commit `.pmkit/config.yaml`. Stop here.
11. For an undo, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate undo --dry-run --json`. For an import map, it prints the git commands that take the import back and writes nothing: show them and stop. For an export map, show every record in `removals`, the ones changed in Linear since the export (`changed`) first, and the `requests`.
12. Ask with `AskUserQuestion` whether to delete those records in Linear, naming the `digest`. When the user agrees, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" local-migrate undo --expect <digest> --json` and report `removed` and `next`. On a failure, the `next` step resumes the undo.

## Confirmation points

- Step 3: whether to resume an unfinished map.
- Step 4: each open mapping question of an export.
- Step 6: the full preview of the export or the import. A migration is a bulk change, so `write_policy.confirm: none` does not skip it.
- Step 10: the config lines the switch writes.
- Step 12: the full list of the records the undo deletes.

## Output

After a write: the direction, `done` of `total`, the map path and the next step, which is a commit, a resume or the switch. After a dry run the user declined: one line saying nothing changed. After an undo of an import map: the git commands.

## If something is missing

- `NOT_CONFIGURED` about git: a migration needs a git repository and a clean tree. Say so, and stop.
- `NOT_CONFIGURED` about the workspace or the team: ask for them with `AskUserQuestion` and pass `--workspace` and `--team`.
- `NOT_CONFIGURED` about the Linear key: send the user to `/pmkit:setup`.
- `CONFLICT` on an import: the Local tracker already holds issues or epics. An import writes only into an empty tracker.
- `CONFLICT` on `--expect`: the trackers changed since the preview. Run the dry run again and show the new preview.
- `INVALID_INPUT` about the digest: an export, an import or an undo without `--expect` writes nothing. Run the dry run (step 4 for an export or an import, step 11 for an undo), show the preview, and pass its `digest`.
- An error from the CLI: apply the rules for reading errors in the conventions.
