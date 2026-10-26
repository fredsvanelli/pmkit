---
description: Summarize an issue or an epic from its record, comments and history
argument-hint: "<id>"
disable-model-invocation: true
---

# Summarize an issue

Arguments: `$ARGUMENTS`

## Parameters

- `id` (required): an issue ID or an epic ID, for example `ISS-7K3Q` or `EPC-2M9D`.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Read the record. An ID that starts with the epic prefix (for example `EPC-`) is an epic. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic get <id> --json` and `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic updates <id> --json`. For any other ID, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --history --json`.
2. For an epic, or any issue with `children`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <id> --json` and use the children and their status categories.
3. Use the comments and the history of the last 30 days. When the record has older entries, say "summarizing the last 30 days" in the output. Do not read older entries.
4. Write four short sections from what the record says. Do not invent anything that the record does not state.
   - Decisions: what was settled, from the comments and the description.
   - Open points: unanswered questions, unchecked acceptance criteria, children that are not done.
   - Blockers: each issue in `blockedBy` that is not done or canceled, with its ID.
   - Next steps: what the record implies comes next. Say "none recorded" when it implies nothing.
5. For an issue, offer to post the summary as a comment. Skip this step for an epic, because `issues comment` only takes an issue ID. When the user accepts, write the summary to standard input and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file - --dry-run --json`. Show the comment text and ask once with `AskUserQuestion`. When the user declines, post nothing. When the user approves, run the same command without `--dry-run`, with the same text.

## Confirmation points

- Step 5: posting the summary of an issue as a comment asks once, before the comment is posted. When the user declines the offer, post nothing.
- The summary itself only reads.

## Output

The issue line with its full ID, status and assignee, then the four sections, each with at most five lines. Say which path was used when the history was cut to 30 days.

## If something is missing

- No ID: ask for it.
- No comments and no history: summarize from the description and the fields, and say there is no discussion yet.
- An error from the CLI: apply the rules for reading errors in the conventions.
