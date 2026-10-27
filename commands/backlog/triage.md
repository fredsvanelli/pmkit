---
description: Triage the issues nobody has looked at yet and apply the decisions you accept
argument-hint: ""
disable-model-invocation: true
---

# Triage the backlog

Arguments: `$ARGUMENTS`

## Parameters

None. Every issue in the `triage` category is in scope.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --category triage --json`. Show each entry of `problems` as a warning, because an unreadable issue is not in the queue. An empty queue ends the command (see "If something is missing").
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the allowed priorities and labels.
3. For each issue, form a proposal from the title, type, description and comments. Priority, labels, duplicate and decline are proposals, not facts. A duplicate match is a guess, and the table shows the original's status.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues get <id> --comments --json` for every issue in the queue, because `issues list` returns the description but not the comments.
   - Priority: one of the allowed values, with a one-line reason. Leave it empty when the text gives no basis, and say so.
   - Labels: zero or more values from `discover`, never a value outside it.
   - Duplicate: run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text "<key word>" --json` once for each key word of the title, one word per search, because `--text` matches one substring of the title or description and several words in one search find only that exact phrase. Judge the matches from their titles and descriptions, in every category except the issue itself. Name the likely original. Keep one issue of each set of issues that repeat each other: the one outside `triage` when there is one, otherwise the oldest by `created`. Every other issue of the set in the queue is a duplicate of the kept one. Never propose `duplicate` or `decline` for a kept issue that is in the queue, so that applying all proposals never cancels the whole set. When the original is `done` or `canceled`, the proposal is still a duplicate.
   - Decline: propose it only when the text shows a reason the issue should not be worked, for example it asks for something the project says it will not do. Write the reason in one sentence.
   - Needs info: when the description cannot support any proposal, propose nothing and leave the issue in `triage`. Say what is missing.
4. Show the queue as an issue table with the columns ID, title, status, assignee, estimate, then proposal (`accept`, `duplicate of <id> (<status>)`, `decline` or `needs info`), priority and labels. Write the reason for each proposal below the table in one line per issue. Page the table at 10 rows.
5. Ask with `AskUserQuestion` how to continue: apply all proposals, apply one group (accept, duplicate or decline), go through them one by one, or stop. In the one-by-one path, ask per issue to accept the proposal, change it (a different priority, labels, original or reason) or skip it. A skipped issue stays in `triage`. When the user accepts nothing, stop and change nothing.
6. Run the dry run of every accepted decision, so the preview matches what is written.
   - Accept: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues update <id> --priority <p> --label <existing,new> --dry-run --json` when the priority or labels change. `--label` replaces the list, so send the existing labels plus the accepted ones. Then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> backlog --dry-run --json`.
   - Duplicate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <dup> <kept> --kind duplicate --dry-run --json`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <dup> canceled --dry-run --json`.
   - Decline: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues move <id> canceled --dry-run --json`, then `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues comment <id> --body-file <file> --dry-run --json`, with the reason written to a file outside `.issues/`.
   - Skip a write whose `before` equals `after`, and say nothing would change.
7. This is a bulk change, so show the full preview of all accepted decisions, with before and after per issue and only the fields that change, and ask once with `AskUserQuestion`, whatever `write_policy.confirm` says. When the user declines, change nothing.
8. When the user approves, run the same commands without `--dry-run`, issue by issue, in the order of step 6. When one fails, stop, list what was applied and what was not, and do not retry it. Apply the error rules of the conventions.
9. Run step 1 again and compare the count, then remove the temporary files.

## Confirmation points

- Step 5: which decisions to apply, and the edits to them.
- Step 7: the full preview of all accepted decisions, always asked because it changes more than one record. Declining changes nothing.

## Output

A table of the applied decisions with the full ID, the decision, the new status, the priority and the labels. Then the count of issues left in `triage` and, for each, whether it was skipped or needs information. State that the priorities, labels and duplicate matches are proposals from the text of the issues.

## If something is missing

- An empty queue: say there is nothing to triage, read nothing else and write nothing.
- `discover` lists no labels: propose priorities only and say so.
- A proposed original cannot be read: drop the duplicate proposal for that issue and say why.
- An error from the CLI: apply the rules for reading errors in the conventions.
