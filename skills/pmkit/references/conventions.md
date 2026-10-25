# Command conventions

Every `/pmkit:*` command applies these rules. Read this file before the first step of any command. The commands do not repeat it.

## Rules

1. Read the config first. Load `.pmkit/config.yaml` and the capability manifest. If either is missing, stop and offer `/pmkit:setup`.
2. Talk in categories and call in operations. Commands use the common model (status categories, issue fields) and the CLI commands. They never use adapter details.
3. Confirm by risk, as the write policy below says. Reads run freely.
4. Say which path was used. When a result is derived or degraded, say so in one line, for example "velocity computed from the last 3 sprints".
5. Keep the output short. Lead with the answer. Show a list of issues as a table. Write every issue ID in full so the user can copy it.
6. Fail with a next step. An error names what went wrong and what to do, for example "no sprint is active; create one with `/pmkit:cycle:plan`".

## Write policy

Reads run freely. A single write shows before → after (from `--dry-run`) and asks once. A bulk change (more than one record), an archive, a scope move or a published status update shows a full preview first. `write_policy.confirm: none` skips the single-write question, never the preview of a bulk change **(builder's call)**.

## How to show a write

1. Run the CLI command with `--dry-run --json`. Nothing changes on disk.
2. Show the `before` and `after` of each record, field by field, and only the fields that change. For a create, show the new record.
3. Ask with `AskUserQuestion`, following `write_policy.confirm` in `.pmkit/config.yaml`. A bulk change, an archive, a scope move or a published status update always shows the full preview and asks, whatever `confirm` says.
4. When the user approves, run the same command again without `--dry-run`. When the user declines, stop and change nothing.

## Reading errors

Every CLI call ends with `--json`. On a failure the CLI exits with code 2 and prints `{ "error": { "code", "message", "nextStep" } }`.

- Show `error.message` as it is.
- Show `error.nextStep` as the thing to do next, and offer to run it when it is a command.
- Use `error.code` to decide what to do. `NOT_CONFIGURED` means offer `/pmkit:setup`. `NOT_FOUND` and `INVALID_INPUT` mean ask the user for a corrected value. Do not retry the same call.
- Never hide an error or guess a fix.

## Issue tables

A list of issues is a table with these columns, in this order: ID, title, status, assignee, estimate. Leave a cell empty when the issue has no value for it. A command may add a column its result needs, after these five.

Rows go in creation order, oldest first, unless the user asks for another order. A command that ranks issues to pick one, such as a recommended next issue or a sprint scope, still uses its own ranking for that choice, and the table it shows keeps creation order.

## The tracker files

Commands never edit files under `.issues/` by hand. Every change goes through a `pmkit.mjs` command, which validates the change and records an event. The one exception is `/pmkit:local:doctor`, which resolves git conflict markers file by file after the user approves each edit.
