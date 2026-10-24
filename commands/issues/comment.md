---
description: Add a comment to an issue
argument-hint: "<id> [text]"
disable-model-invocation: true
---

# Comment on an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID.
- `text` (optional): the comment. When it is empty, ask for it.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Collect the comment text. Keep the user's words. Do not add a greeting or a sign-off.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file - --dry-run --json` and send the text on standard input.
3. Show the issue ID and the full comment text. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and post nothing.
4. When the user approves, run the same command without `--dry-run`, sending the same text on standard input.

## Confirmation points

- Step 3: the comment, before it is posted. `write_policy.confirm: none` skips this question.

## Output

One line: the comment was added to the issue, with its full ID and the time it was posted.

## If something is missing

- No ID: ask for it.
- An empty comment: ask for the text. Do not post an empty comment.
- An error from the CLI: apply the rules for reading errors in the conventions.
