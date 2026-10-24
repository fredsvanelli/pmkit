---
description: Change the fields of an issue, such as title, priority, estimate, labels or acceptance criteria
argument-hint: "<id> [change]"
disable-model-invocation: true
---

# Update an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID, for example `ISS-7K3Q`.
- `change` (optional): what to change, in plain words. When it is empty, ask what to change.

This command edits title, type, priority, estimate, labels, sprint, due date, milestone, branch, description and acceptance criteria. For other changes, use the command that owns them:

- status: `/pmkit:issues:move`;
- assignee: `/pmkit:issues:assign`;
- parent, blocks, related and duplicate links: `/pmkit:issues:link`;
- archive: not done by this command; archiving is a separate write with its own preview.

`issues update` refuses parent, links and archived. Never try them here. Point the user to the command above.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` to read the current record. When the issue does not exist, apply the rules for reading errors.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and check each new value against the allowed types, priorities, labels and the estimate scale. When a value is not allowed, show the allowed ones and ask for a corrected value.
3. Split the request. A part that belongs to another command (see Parameters) is not run here. Name the command for it in the output.
4. For a new description or new acceptance criteria, write the text to a temporary file outside `.issues/` and pass it with `--description-file` or `--criteria-file`. To tick or untick a criterion, use `--check <n>` or `--uncheck <n>` with the criterion number from step 1.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> <flags> --dry-run --json`.
6. Show `before` and `after` for each field that changes. Follow "How to show a write" in the conventions: ask once with `AskUserQuestion`. A change of `--sprint` is a scope move: it always shows the full preview and asks, whatever `write_policy.confirm` says. When the user declines, stop and change nothing.
7. When the user approves, run the same command without `--dry-run`, then remove the temporary files.

## Confirmation points

- Step 6: the before and after of the changed fields. `write_policy.confirm: none` skips this question, except when `--sprint` changes, which always asks.

## Output

The updated issue as a one-row issue table, and the list of fields that changed. When step 3 left a part undone, name the command that does it, for example "to set the parent, run `/pmkit:issues:link`".

## If something is missing

- No ID: ask for it.
- No change: ask what to change.
- The change is only a parent, a link or an archive: do not run `issues update`. Say which command to use.
- An error from the CLI: apply the rules for reading errors in the conventions.
