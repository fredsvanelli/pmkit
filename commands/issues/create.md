---
description: Create an issue, with the fields checked against the project config
argument-hint: "[title]"
disable-model-invocation: true
---

# Create an issue

Arguments: `$ARGUMENTS`

## Parameters

- `title` (optional): the issue title. When it is empty, ask for it.

Optional fields, asked for only when the user did not give them: type, priority, estimate, assignee, labels, parent, sprint, due date, milestone, release, description and acceptance criteria. The command never asks for a field the user left out on purpose.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the allowed types, priorities, labels, members and the estimate scale.
2. Collect the title and the fields from the user's words. Check each value against step 1. When a value is not allowed, show the allowed ones and ask for a corrected value.
3. When the description or the acceptance criteria are given, write each to a temporary file outside `.issues/` and pass it with `--description-file` or `--criteria-file`. Write one criterion per line.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" <fields> --dry-run --json`, with only the flags the user gave: `--type`, `--priority`, `--estimate`, `--assignee`, `--label`, `--parent`, `--sprint` (a sprint id, `current` or `none`), `--due`, `--milestone`, `--release`, `--description-file`, `--criteria-file`.
5. Show the new record from the dry run, field by field. Follow "How to show a write" in the conventions: ask once with `AskUserQuestion`. When `--sprint` is set, the issue enters a sprint, which is a scope move: it always shows the full preview and asks, whatever `write_policy.confirm` says. When the user declines, stop and create nothing.
6. When the user approves, run the same command without `--dry-run`.
7. Remove the temporary files.

## Confirmation points

- Step 5: the new record, before it is written. `write_policy.confirm: none` skips this question, except when `--sprint` is set, which always asks.

## Output

The new issue line with its full ID, as a one-row issue table. Offer `/pmkit:issues:assign` when it has no assignee, and `/pmkit:issues:link` to attach it to a parent.

## If something is missing

- No title: ask for it.
- A parent, sprint or member that does not exist: the CLI answers `INVALID_INPUT`. Ask for a corrected value, and do not create the issue without it.
- `--sprint current` with no active sprint: the dry run in step 4 answers `INVALID_INPUT` "there is no active sprint" before the confirmation question. Say so, show no preview, and offer `/pmkit:cycle:plan` or creating the issue without a sprint.
- An error from the CLI: apply the rules for reading errors in the conventions.
