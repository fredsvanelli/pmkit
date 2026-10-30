---
description: Create an issue from an idea, refined into context, scope, tasks and acceptance criteria, with the fields checked against the project config
argument-hint: "[idea or title]"
disable-model-invocation: true
---

# Create an issue

Arguments: `$ARGUMENTS`

## Parameters

- `idea or title` (optional): what the issue is about, from a title to a vague idea of a feature. When it is empty, ask for it.

The command always refines the idea into a full ticket before it creates anything. It takes the fields the user gave in the request (type, priority, estimate, assignee, labels, parent, sprint, due date, milestone, release), and suggests a type, priority, estimate and parent when the user gave none. It never asks for a field the user left out on purpose.

The description follows this template. Each section heading is `###`, because the CLI rejects a `## ` line inside the description. The headings stay in English and the text follows the language of the user's request. The acceptance criteria go in their own field, not in the description. Write them one per line, and the issue shows them as checkboxes under `## Acceptance criteria`.

```markdown
### Context

Why the work is needed now, and for whom.

### Scope (in)

- What the work covers

### Out of scope

- What the work leaves out on purpose

### Tasks

- [ ] One task per line
```

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the allowed types, priorities, labels, members and the estimate scale. Collect the fields from the user's words and check each value against this list. When a value is not allowed, show the allowed ones and ask for a corrected value.
2. Learn about the request before asking anything:
   - Read the README and the docs of the repository.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text "<key word>" --json` once for each of the 2 or 3 most specific key words of the idea. The CLI matches `--text` as one phrase, not word by word, so pass a single word each time, such as `webhook`, not `delivery history webhook`.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" epic list --json` and note the epics the idea belongs to.
   - Read the code the idea touches, to understand what exists today and what the request changes.
3. When there are likely duplicates, show each one as an issue table row and ask with `AskUserQuestion` whether to use an existing issue, create a new one anyway, or stop. When the user picks an existing issue, give its ID and stop. When the user stops, create nothing.
4. Ask 2 or 3 short questions on the context and the scope, one per message, informed by step 2. Skip a question that the request or step 2 already answers. When the user already gave a full description, ask nothing and fit the text into the template, then name the sections that are still empty.
5. Draft the issue with a title, the description in the template above, and the acceptance criteria. Write each task as a step of work at the level of the product, such as "Show the delivery history on the webhook page". A task names an area of the product, never a file, a function or a change to the code. Write each criterion as a result a person can check without reading the code. When the user gave no type, priority, estimate or parent, suggest one from step 1, and the related epic from step 2 as the parent.
6. Write the description and the criteria to temporary files outside `.issues/`, one criterion per line. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" <fields> --description-file <file> --criteria-file <file> --dry-run --json`, with only the flags the draft or the user gave: `--type`, `--priority`, `--estimate`, `--assignee`, `--label`, `--parent`, `--sprint` (a sprint id, `current` or `none`), `--due`, `--milestone`, `--release`.
7. Show the full ticket from the dry run: the fields, then the description and the acceptance criteria as they will appear. The dry run returns an ID that the real create does not reuse, so call it "the new issue" and do not show that ID. Ask with `AskUserQuestion` whether to create it, edit it or stop. This question always shows the full ticket, whatever `write_policy.confirm` says, because the draft is Claude's writing. When the user edits, change the draft, write the files again, and repeat step 6 and this step. When the user stops, create nothing.
8. When the user approves, run the command of step 6 without `--dry-run`.
9. Remove the temporary files.

## Confirmation points

- Step 3: what to do with likely duplicates.
- Step 7: the full ticket, before it is written. It is always asked, whatever `write_policy.confirm` says.

## Output

The new issue line with its full ID, as a one-row issue table. Offer `/pmkit:issues:assign` when it has no assignee, and `/pmkit:issues:link` to attach it to a parent when it has none.

## If something is missing

- No idea and no title: ask for it.
- No README and no docs: skip them and say so in one line.
- A value that is not allowed: show the allowed ones from step 1 and ask for a corrected value.
- A parent, sprint or member that does not exist: the CLI answers `INVALID_INPUT`. Ask for a corrected value, and do not create the issue without it.
- `--sprint current` with no active sprint: the dry run in step 6 answers `INVALID_INPUT` "there is no active sprint" before the confirmation question. Say so, show no preview, and offer `/pmkit:cycle:plan` or creating the issue without a sprint.
- An error from the CLI: apply the rules for reading errors in the conventions.
