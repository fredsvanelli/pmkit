---
description: Find issues with a plain-language question, such as "high-priority bugs in the current sprint"
argument-hint: "<question>"
disable-model-invocation: true
---

# Find issues

Arguments: `$ARGUMENTS`

## Parameters

- `question` (required): what the user wants to find, in plain words. When it is empty, ask for it.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the statuses with their categories, the types, the labels and the members.
2. Translate the question into flags of `issues list`. The flags are `--text`, `--category`, `--type`, `--assignee me|none|<member>`, `--label`, `--sprint current|none|<id>`, `--parent`, `--blocked`, `--updated-before`, `--updated-after`, `--sort priority|updated|created|due`, `--limit` and `--archived`. Rules:
   - Map a status word to a category, for example "in review" to `in_review` and "open" to `backlog,todo,in_progress,in_review`.
   - Map "mine" to `--assignee me` and "unassigned" to `--assignee none`.
   - Turn a relative date such as "this week" into a `YYYY-MM-DD` date.
   - Choose `--sort` from the question: "most urgent" means `priority`, "recently changed" means `updated`, "oldest" means `created`, "due soon" means `due`. When the question names no order, leave `--sort` out, and the CLI lists the oldest created first.
   - Use `--text` only for words that match no other flag.
3. When a person or a label in the question matches more than one value from step 1, or none exactly, show the closest matches and ask with `AskUserQuestion` which one the user means. When the user declines to choose, drop that filter and say so.
4. Show the flags in one line, for example "Filter: --type bug --sprint current --sort priority", so the user can correct them. Do not wait for an answer. When the user corrects the filter, rerun from step 3 with the correction.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list <flags> --json`.
6. Show the result as an issue table and the count.
7. When the user has asked this kind of question before in this conversation, offer to save it as a view, but only when `capabilities --json` reports `saved_views` as `native` without `saveView` in its `detail.unsupported`. Otherwise offer only the flags to reuse. Ask for a name, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" views save <name> <flags> --dry-run --json`, show the filter, and ask once following "How to show a write" in the conventions. After approval, run it without `--dry-run`. Tell the user that `views run <name>` runs the view again and `views list` lists the views.

## Confirmation points

- Step 7: the name of the view, then the filter to save, before `views save` runs. `write_policy.confirm: none` skips the second question. The search itself only reads, and the question of step 3 is a choice between matches.

## Output

The one-line filter, the issue table (see the conventions), and "N issues". When the sort came from the question, say which sort was used. When the list is empty, say so and name the filter that is likely too narrow.

## If something is missing

- No sprint is active and the question says "current sprint": say that no sprint is active and offer `/pmkit:cycle:plan`.
- The question names a field the tracker has no flag for: run the closest filter and say which part of the question it does not cover.
- `views save` answers `CONFLICT` because the name exists: ask for another name, or offer `--overwrite`.
- An error from the CLI: apply the rules for reading errors in the conventions.
