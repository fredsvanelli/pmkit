---
description: Read the ideas of a Jira Product Discovery project with their votes and delivery work, and connect an idea to an epic
argument-hint: "[project key]"
disable-model-invocation: true
---

# Jira Product Discovery

Arguments: `$ARGUMENTS`

## Parameters

- A project key (optional): the Jira Product Discovery project to read. Without it, the command reads the site's only Jira Product Discovery project, and asks which one when there are several.
- `--limit <n>` (optional): passed to the idea list to cap how many ideas are read (default: 50, newest first).

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" capabilities --json`. When `tracker` is not `jira`, say that this command works only with the Jira tracker and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" jira ideas list --json`, with `--project <KEY>` when the user named a project and `--limit <n>` when the user asked for one. When the CLI fails with `INVALID_INPUT` because the site has several Jira Product Discovery projects, ask which one with `AskUserQuestion`, offering the keys the error lists, and run the list again with `--project <KEY>`. When `available` is false, print `reason` and `enableHint`, say that the site has no Jira Product Discovery project the token's owner can browse, and stop.
3. Show the ideas of the project as a table with the key, title, status, votes, insights and delivery. Sort it by votes, highest first, with the ideas whose votes are unread (`value` null) last. A project with several votes fields shows each by its field name. Show the insights as unread, and say plainly that Jira's REST API does not return Jira Product Discovery insights, so pmkit cannot count them. The delivery column lists the work items linked as delivery (`epics`), or none. Show each warning. When `hasMore` is true, say that the list was cut and offer to run it again with a larger `--limit`.
4. When the user wants to connect an idea to an epic, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" jira ideas connect <idea> <epic> --dry-run --json` with the idea key and the epic key. Show the link type and the delivery `before` and `after`. When they are equal, say that the idea is already connected to the epic and stop. Otherwise ask once with `AskUserQuestion` whether to connect them. When the user declines, change nothing. After approval, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" jira ideas connect <idea> <epic> --json` and say that the idea is connected.

## Confirmation points

- Step 2: which Jira Product Discovery project to read, only when the site has several and the user did not name one.
- Step 4: the preview of the connection, before the link is written. Declining changes nothing.

## Output

The ideas of the project with their status, votes and delivery work, the insights shown as unread, the warnings, and for a connection the delivery before and after.

## If something is missing

- A tracker that is not Jira: stop at step 1.
- No `JIRA_EMAIL` or `JIRA_API_TOKEN`: the CLI fails with `AUTH`. Apply the rules for reading errors in the conventions.
- No Jira Product Discovery project on the site, or none the token's owner can browse: step 2 stops with the `enableHint`.
- A project key that is not a Jira Product Discovery project: the CLI fails with `NOT_FOUND` and names the keys to pass. Ask which one.
- Insights: Jira's REST API does not return them, so they are always unread. A follow-up in EPC-14 checks another way to read them.
- An idea key that is not an idea, or an epic key that is not an epic of `tracker.scope.space`: the CLI fails with `NOT_FOUND`. Check that the idea comes first and the epic second.
- No delivery link type on the site: the CLI fails with `NOT_SUPPORTED`. Jira Product Discovery adds that link type itself; ask an admin to check it.
- Disconnecting an idea from an epic: not supported. Remove the link in Jira.
- `hasMore` is true: say that the list was cut and offer `--limit`.
- An error from the CLI: apply the rules for reading errors in the conventions.
