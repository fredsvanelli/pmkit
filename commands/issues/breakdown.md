---
description: Break an issue into sub-issues with estimates, order and blockers
argument-hint: "<id>"
disable-model-invocation: true
---

# Break an issue down

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue to break down. An epic ID (`EPC-` by default) is not accepted here, because sub-issues attach to issues. For an epic, ask which of its issues to break down.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --json`. Note the description, the acceptance criteria, the estimate, the sprint and the existing `children`. When it has children, list them and ask with `AskUserQuestion` whether to add more sub-issues. When the user declines, stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types, priorities and the estimate scale.
3. Read the code the issue affects.
4. Propose the sub-issues. Each has a title, a type, an estimate from the scale, an order number and the sub-issues that block it. Cover every acceptance criterion of the parent.
5. Show the full proposal as a table (order, title, type, estimate, blocked by) with the total estimate next to the parent's. This is a bulk create, so it always shows the full list and asks, whatever `write_policy.confirm` says. Ask with `AskUserQuestion` whether to create all of them. Let the user edit, remove or add rows, then show the list again. When the user declines, stop and create nothing.
6. Run the dry run of each sub-issue to check the values: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --parent <id> --type <type> --estimate <n> --dry-run --json`. When a dry run fails, show the error and ask for a corrected value before any create. When a value changes, run the dry run of that row again, show the table of step 5 again with the corrected row, and ask again with `AskUserQuestion`. When the user declines, stop and create nothing.
7. After the approval of step 5, create the sub-issues in order. Run the same command for each without `--dry-run` and note the new ID. When one fails, stop, list what was created and what was not, and do not retry it.
8. For each blocker in the proposal, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <blocking id> <blocked id> --kind blocks --json`, using the new IDs. The approval of step 5 covers these links, because the table showed them.

## Confirmation points

- Step 5: the full list of sub-issues, estimates and blockers, always asked because it creates more than one record. It also covers the links of step 8. Declining creates nothing.
- Step 6: the table again, when a failed dry run led to a corrected value. Declining creates nothing.
- Step 1: whether to add more when the issue already has children.

## Output

The tree of created sub-issues under the parent, each with its full ID, title, estimate and blockers. Then the total estimate against the parent's estimate, and a warning when they differ.

## If something is missing

- No ID: ask for it.
- The issue has no description and no criteria: ask the user what the work covers before proposing.
- No estimate scale value fits: leave the estimate empty and say so.
- An error from the CLI: apply the rules for reading errors in the conventions.
