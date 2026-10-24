---
description: Assign an issue to a member, to yourself or to nobody
argument-hint: "<id> <member>"
disable-model-invocation: true
---

# Assign an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID.
- `member` (required): a member ID, a name, `me` or `none`. `none` clears the assignee.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the members.
2. Resolve `member` to a member ID. Keep `me` and `none` as they are. When a name matches more than one member, or none exactly, show the closest matches and ask with `AskUserQuestion` which one the user means. When the user declines to choose, stop and change nothing.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues assign <id> <member|me|none> --dry-run --json`.
4. Show `before` and `after` of the assignee. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and change nothing.
5. When the user approves, run the same command without `--dry-run`.

## Confirmation points

- Step 4: the assignee change. `write_policy.confirm: none` skips this question.
- Step 2 is a choice between matches, not a confirmation.

## Output

The updated issue line with its full ID and its new assignee. When the issue already had that assignee, say so and change nothing.

## If something is missing

- No ID or no member: ask for it.
- `me` and the CLI cannot tell who the user is: it answers `NOT_CONFIGURED`. Show the next step it names.
- An error from the CLI: apply the rules for reading errors in the conventions.
