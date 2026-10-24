---
description: Move an issue to a status category, such as in progress, in review or done
argument-hint: "<id> <category>"
disable-model-invocation: true
---

# Move an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID.
- `category` (required): `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done` or `canceled`. Accept plain words such as "review" or "finished" and map them to a category.
- `--status <name>` (optional): a status name, when the category has more than one status.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` to read the issue, its `children` and its `blockedBy`.
2. When the category is `done`, check two things from step 1. Warn when a child issue is not in the `done` or `canceled` category. Warn when a blocker is not in the `done` or `canceled` category. Look up each child and blocker with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <child-or-blocker-id> --json`. List them by ID in the warning.
3. When the category has more than one status and the user gave no `--status`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and ask with `AskUserQuestion` which status to use.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> <category> [--status <name>] --dry-run --json`.
5. Show `before` and `after` of the status, with the warnings of step 2 above them. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and change nothing.
6. When the user approves, run the same command without `--dry-run`.

## Confirmation points

- Step 5: the status change, with any warning from step 2. A warning does not block the move. The user decides. `write_policy.confirm: none` skips the question but never the warning, which is shown in the output instead.
- Step 3 is a choice of input, not a confirmation.

## Output

The updated issue line with its full ID and new status. When a warning applied and the user went ahead, repeat it in one line.

## If something is missing

- No category: ask for it, and list the seven categories.
- The category is the current one: say so and change nothing.
- An error from the CLI: apply the rules for reading errors in the conventions.
