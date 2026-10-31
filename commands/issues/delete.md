---
description: Delete an issue for good, after a full preview. Refuses while other issues reference it. Archive keeps the issue instead
argument-hint: "<id>"
disable-model-invocation: true
---

# Delete an issue

Arguments: `$ARGUMENTS`

Deleting removes the issue, its events and its comments. Archiving keeps the record and its history and only hides the issue from lists. On the Local tracker only git history brings a deleted issue back. On Linear the issue goes to Linear's trash. When the user only wants the issue out of the way, offer `pmkit issues archive <id>` and stop.

## Parameters

- `id` (required): the issue ID.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` to read the issue. When the user wants it hidden and not removed, offer `issues archive` here and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues delete <id> --dry-run --json`. Nothing changes on disk.
3. When the call fails with `CONFLICT`, other records reference the issue. Show `error.references` as a table with ID and kind (`blockedBy`, `related`, `duplicateOf` or `parent`), and under it the commands in `error.nextStep` that remove each reference. Offer `issues archive <id>` as the way to keep the history. Do not delete, and do not remove references yourself without the user's say-so. Each removal is its own write.
4. When the call fails with `INVALID_INPUT` and `error.problems`, some issue files do not parse, so the references cannot be checked. List the problems, offer `pmkit validate` and `/pmkit:local:doctor`, and stop.
5. Show the full preview from the dry run. Show the issue record from `before` and `removes` (the files, and the counts of events and comments that go). Show every line of `warnings`, then `mentions` as "the text of these issues cites it and stays as it is", then `unchecked` as "not checked". Say that archive is the reversible neighbor.
6. Ask with `AskUserQuestion`: "Delete <id> for good?" with the options delete and keep. A delete always shows the full preview and asks, whatever `write_policy.confirm` says. When the user declines, stop and change nothing.
7. When the user approves, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues delete <id> --json`. With `auto_commit` on, the commit that removes the folder is made by the CLI.

## Confirmation points

- Step 6: the full preview, always asked. `write_policy.confirm: none` does not skip it. Declining changes nothing.

## Output

One line, `deleted <id> <title>`, from `before` of the result. Say once that the issue is gone from lists and that git history (Local) or Linear's trash (Linear) is the way back.

## If something is missing

- `NOT_FOUND`: show `error.message` and offer `/pmkit:issues:find`.
- `CONFLICT` for references: step 3. After the user removes the references, run the command again from step 2.
- An error from the CLI: apply the rules for reading errors in the conventions.
