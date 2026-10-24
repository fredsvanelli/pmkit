---
description: Open an issue from what the session found, such as an error, a failing test or a TODO, after a check for duplicates
argument-hint: "[what to capture]"
disable-model-invocation: true
---

# Capture an issue

Arguments: `$ARGUMENTS`

## Parameters

- `what to capture` (optional): a short description of the problem. When it is empty, use the evidence in the session: the last error, failing test, stack trace or diff.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Collect the evidence: the error text, the relevant diff, the files involved and the steps to reproduce. Redact secrets (tokens, passwords, keys, private URLs) from everything before it goes into the issue.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` to get the allowed types, priorities and labels.
3. Draft the issue: a title, a type, a description with the evidence, acceptance criteria (one per line) and a suggested priority. Use only values from step 2.
4. Look for duplicates. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues list --text "<key words from the title>" --json` and, if the first search finds nothing, once more with the main error message. Show each likely match as an issue table row.
5. When there are likely duplicates, ask with `AskUserQuestion` whether to use an existing issue, create a new one anyway, or stop. When the user picks an existing issue, give its ID and stop. When the user stops, create nothing.
6. Write the description and the criteria to temporary files outside `.issues/`. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --priority <priority> --description-file <file> --criteria-file <file> --dry-run --json`.
7. Show the new record from the dry run, field by field. Ask once, following "How to show a write" in the conventions. When the user declines, stop and create nothing.
8. When the user approves, run the same command without `--dry-run`.
9. When the user named a related issue, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues link <new id> <other id> --kind related --dry-run --json`, show it and ask once. When the user approves, run it without `--dry-run`. When the user declines, keep the new issue and skip the link.
10. Remove the temporary files.

## Confirmation points

- Step 5: what to do with likely duplicates.
- Step 7: the draft, before it is created. `write_policy.confirm: none` skips this question.
- Step 9: the link, when there is one. The same setting skips it.

## Output

The new issue line with its full ID, as a one-row issue table, or the existing duplicate the user chose. Mention anything redacted in one line.

## If something is missing

- No evidence in the session and no argument: ask what to capture.
- A type, priority or label that is not allowed: show the allowed values and ask for a corrected one.
- An error from the CLI: apply the rules for reading errors in the conventions.
