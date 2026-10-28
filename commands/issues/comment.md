---
description: Add a comment to an issue
argument-hint: "<id> [text] [--reply-to comment] [--resolve comment]"
disable-model-invocation: true
---

# Comment on an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): the issue ID.
- `text` (optional): the comment. When it is empty, ask for it.
- `reply-to` (optional): the ID of a comment on the issue. The new comment joins that comment's thread. A reply to a reply joins the root.
- `resolve` (optional): the ID of a comment on the issue. Resolves its thread instead of posting a comment.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Collect the comment text. Keep the user's words. Do not add a greeting or a sign-off.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file - --dry-run --json` and send the text on standard input. For a reply, add `--reply-to <comment>`.
3. Show the issue ID and the full comment text. Follow "How to show a write" in the conventions: ask once. When the user declines, stop and post nothing.
4. When the user approves, run the same command without `--dry-run`, sending the same text on standard input.

## Resolve the thread

When the user asks to resolve a thread, or passes `resolve`, post no comment.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json` and show the thread: the root comment and its replies.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues resolve <id> <comment> --dry-run --json`. Show the issue ID and the root comment. Follow "How to show a write" in the conventions: ask once. When the user declines, stop.
3. When the user approves, run the same command without `--dry-run`.

A thread that is already resolved changes nothing. Tell the user.

## Confirmation points

- Step 3: the comment, before it is posted. `write_policy.confirm: none` skips this question.
- Resolving: the thread, before it is resolved. The same setting skips this question.

## Output

One line: the comment was added to the issue, with its full ID and the time it was posted. For a resolved thread: the thread was resolved, with the issue ID and the root comment ID.

## If something is missing

- No ID: ask for it.
- An empty comment: ask for the text. Do not post an empty comment.
- A `reply-to` or `resolve` ID that is not on the issue: the CLI answers `NOT_FOUND`. Run `issues get <id> --comments` and ask which comment is meant.
- An error from the CLI: apply the rules for reading errors in the conventions.
