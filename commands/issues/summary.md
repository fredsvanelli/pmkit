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

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --history --json`.
2. For an epic, or any issue with `children`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --parent <id> --json` and use the children and their status categories.
3. Use the comments and the history of the last 30 days. When the record has older entries, say "summarizing the last 30 days" in the output. Do not read older entries.
4. Write four short sections from what the record says. Do not invent anything that the record does not state.
   - Decisions: what was settled, from the comments and the description.
   - Open points: unanswered questions, unchecked acceptance criteria, children that are not done.
   - Blockers: each issue in `blockedBy` that is not done or canceled, with its ID.
   - Next steps: what the record implies comes next. Say "none recorded" when it implies nothing.
5. Offer to post the summary as a comment. When the user accepts, follow `/pmkit:issues:comment` with the summary text. That command shows the comment and asks before it posts.

## Confirmation points

None for the summary, which only reads. Posting it as a comment (step 5) goes through the confirmation of `/pmkit:issues:comment`. When the user declines the offer, post nothing.

## Output

The issue line with its full ID, status and assignee, then the four sections, each with at most five lines. Say which path was used when the history was cut to 30 days.

## If something is missing

- No ID: ask for it.
- No comments and no history: summarize from the description and the fields, and say there is no discussion yet.
- An error from the CLI: apply the rules for reading errors in the conventions.
