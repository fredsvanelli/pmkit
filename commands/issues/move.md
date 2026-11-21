---
description: Move an issue or an epic to a status category, such as in progress, in review or done
argument-hint: "<id> <category>"
disable-model-invocation: true
---

# Move an issue or an epic

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue or epic ID.
- `category` (required): `triage`, `backlog`, `todo`, `in_progress`, `in_review`, `done` or `canceled`. Accept plain words such as "review" or "finished" and map them to a category.
- `--status <name>` (optional): a status name, when the category has more than one status.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json` to read the issue, its `children` and its `blockedBy`. When it answers `NOT_FOUND` or `INVALID_INPUT`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <id> --json`. When that finds the epic, follow "Epic path" below. When it fails too, show the error of `issues get` and stop.
2. When the category is `done`, check two things from step 1. Warn when a child issue is not in the `done` or `canceled` category. Warn when a blocker is not in the `done` or `canceled` category. Look up each child and blocker with `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <child-or-blocker-id> --json`. List them by ID in the warning.
3. When the category has more than one status and the user gave no status name, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and ask with `AskUserQuestion` which status to use.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> <category> [--status <name>] --dry-run --json`.
5. Show `before` and `after` of the status, with the warnings of step 2 above them. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and change nothing.
6. When the user approves, run the same command without `--dry-run`.

## Epic path

The ID is an epic. Skip steps 2 and 3 of the issue path.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic move <id> <category> [--status <name>] --dry-run --json`. When the category has more than one status and the user gave no status name, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` and ask with `AskUserQuestion` which status to use, as in step 3 of the issue path.
2. Show `before` and `after` of the status, with the warning of the CLI above them. The CLI warns when the epic still has open issues on a move to `done` or `canceled`, and lists them by ID. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and change nothing.
3. When the user approves, run the same command without `--dry-run`.

## Confirmation points

- Step 5: the status change, with any warning from step 2. A warning does not block the move. The user decides. `write_policy.confirm: none` skips the question but never the warning, which is shown in the output instead.
- Epic path, step 2: the status change, with the warning of the CLI. The same rules apply.
- Step 3 is a choice of input, not a confirmation.

## Output

The updated issue or epic line with its full ID and new status. When a warning applied and the user went ahead, repeat it in one line.

## If something is missing

- No category: ask for it, and list the seven categories.
- The category and the status are the current ones: say so and change nothing. For an epic the CLI answers `INVALID_INPUT` and says so. A `--status` change to another status of the same category is a real move, so run steps 4 to 6 for it, or the epic path for an epic.
- An error from the CLI: apply the rules for reading errors in the conventions.
