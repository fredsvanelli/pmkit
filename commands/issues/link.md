---
description: Link two issues (blocks, related, duplicate), remove a link, or set a parent
argument-hint: "<from> <to> [--kind blocks|related|duplicate | --parent | --remove]"
disable-model-invocation: true
---

# Link issues

Arguments: `$ARGUMENTS`

## Parameters

- `from` (required): the issue ID the relation starts from.
- `to` (required): the other issue ID. With a parent, `to` is the parent ID, or `none` to clear the parent.
- Kind: `blocks` (`from` blocks `to`), `related`, `duplicate` (`from` duplicates `to`) or `parent` (`to` is the parent of `from`). Accept plain words such as "ISS-4P8A blocks ISS-7K3Q" and map them.
- `--remove` (optional): remove the link instead of adding it. It does not apply to a parent. To clear a parent, use `none`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Work out the kind and the direction from the user's words. When the kind is not clear, ask with `AskUserQuestion` which of the four kinds the user means. When the user declines, stop and change nothing.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <from> --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <to> --json` (skip the second call for `none`) to check both issues exist and to read their current links.
3. For a link, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <from> <to> --kind <blocks|related|duplicate> [--remove] --dry-run --json`.
4. For a parent, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues parent <from> <to|none> --dry-run --json`.
5. Show `before` and `after` of the relation on each issue the dry run changes. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and change nothing.
6. When the user approves, run the same command without `--dry-run`.

## Confirmation points

- Step 5: the relation change on each issue. `write_policy.confirm: none` skips this question.
- Step 1 is a choice of input, not a confirmation.

## Output

One line that states the relation in words, for example "ISS-4P8A now blocks ISS-7K3Q", with both full IDs. For a removal, say "ISS-4P8A no longer blocks ISS-7K3Q".

## If something is missing

- An issue ID that does not exist: the CLI answers `NOT_FOUND`. Ask for a corrected ID.
- A link that would make a loop, such as a parent that is also a child, or an issue linked to itself: the CLI refuses. Show its message.
- A link to remove that does not exist: say so and change nothing.
- An error from the CLI: apply the rules for reading errors in the conventions.
