# Command conventions

Every `/pmkit:*` command applies these rules. Read this file before the first step of any command. The commands do not repeat it.

## Rules

1. Read the config first. Load `.pmkit/config.yaml` and the capability manifest. If either is missing, stop and offer `/pmkit:setup`.
2. Talk in categories and call in operations. Commands use the common model (status categories, issue fields) and the CLI commands. They never use adapter details.
3. Confirm by risk, as the write policy below says. Reads run freely.
4. Say which path was used. When a result is derived or degraded, say so in one line, for example "velocity computed from the last 3 sprints". The CLI prints the line as `note:`. Repeat it, do not rephrase it.
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
- `NOT_CONFIGURED` with an `error.mappings` list means `.pmkit/config.yaml` maps a team, status, field or label that the tracker no longer has. Stop the command before any other call. Show the `problem` of each item. Ask once with `AskUserQuestion` whether to run `/pmkit:setup` now, which asks again only for these mappings. Never pick a replacement yourself, and do not retry the call.
- Use `error.code` to decide what to do. `NOT_CONFIGURED` means offer `/pmkit:setup`. `NOT_FOUND` and `INVALID_INPUT` mean ask the user for a corrected value. Do not retry the same call.
- An error whose `error.message` starts with `.pmkit/config.yaml is not valid` comes from a broken config file, not from a value the user typed. Check for it before the `INVALID_INPUT` rule above, which asks the user for a corrected value. Stop that write and do not retry it. Show `error.message` as it is, and offer `pmkit validate` to list the problems and `/pmkit:local:doctor` to fix them. Then go on with the command's reads, if it has any. While the file stays broken, every write and dry run fails with this error, and reads print `warning: .pmkit/config.yaml is not valid, so writes are refused: ...` on stderr. Show that warning once. If a read fails with this error too, the CLI cannot find the tracker, so stop the command.
- Never hide an error or guess a fix.

## Issue tables

A list of issues is a table with these columns, in this order: ID, title, status, assignee, estimate. Leave a cell empty when the issue has no value for it. A command may add a column its result needs, after these five.

Rows go in creation order, oldest first, unless the user asks for another order. A command that picks issues from a list, such as a recommended next issue or a sprint scope, also goes in creation order.

## The tracker files

Commands never edit files under `.issues/` by hand. Every change goes through a `pmkit.mjs` command, which validates the change and records an event. The one exception is `/pmkit:local:doctor`, which resolves git conflict markers file by file after the user approves each edit.
