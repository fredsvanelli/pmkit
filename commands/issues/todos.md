---
description: Turn the TODO and FIXME comments of the repository into issues, dropping the ones an issue already covers
argument-hint: "[path]"
disable-model-invocation: true
---

# Turn TODO and FIXME comments into issues

Arguments: `$ARGUMENTS`

## Parameters

- `path` (optional): a folder or file prefix, such as `src/`, to scan instead of the whole repository.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Scan the repository. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" todos scan [--path <path>] --json`. The CLI reads the files git lists, so it respects `.gitignore` and skips `node_modules`, `.issues/`, `.pmkit/`, binary files and files over 1 MiB. It groups a comment that repeats in several places into one candidate with every location, and it drops the candidates an existing issue matches, whatever that issue's status. A match is the `todo-key:` line of an issue this command created (`key`), a `file:line` in the issue text (`source`), or the comment text inside the issue title or text (`text`). When `candidates` is empty, show the `matched` list, say there is nothing to create and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types.
3. Draft one issue per candidate. The title is the candidate `title`. The type is `bug` for a FIXME and `task` for a TODO, when the tracker allows them, else the first allowed type. The description is the candidate `description` as it is, because its `todo-key:` line is what keeps a second run from creating the issue again. Write each description to a temporary file outside `.issues/`.
4. Run the dry run of each issue: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --description-file <file> --dry-run --json`. When a dry run fails, show the error and ask for a corrected value.
5. Show the full preview. First the `matched` comments as information (issue, status, reason, text), and say when a match is `done` or `canceled`, because its comment is still in the code. Then the candidates as a table (key, type, location, title), with `+n` for the extra locations of a repeated comment. This is a bulk create, so it always shows the full list and asks, whatever `write_policy.confirm` says. Ask with `AskUserQuestion` whether to create all of them. Let the user drop rows or edit titles and types, then show the list again, running the dry run again for each changed row. When the user declines, stop and create nothing.
6. After the approval of step 5, create the issues in table order. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --description-file <file> --json` and note the new ID. When one fails, stop, list what was created and what was not, and do not retry it.
7. Remove the temporary files.

## Confirmation points

- Step 4: a corrected value after a failed dry run.
- Step 5: the full list of issues to create, always asked because it creates more than one record. Declining creates nothing. Editing the list shows it again.

## Output

A table of the created issues (full ID, title, type, location), then the comments that already had an issue, with the issue ID and the reason. Mention that running the command again creates nothing for these comments, because each issue holds its `todo-key:` line.

## If something is missing

- The CLI answers `INVALID_INPUT` because the folder is not a git repository: say the scan needs git to honor `.gitignore`, and stop.
- The scan finds no `TODO` or `FIXME` comment: say so and stop. A comment needs a comment mark before the tag (`//`, `#`, `/*`, `*`, `<!--`, `--`, `;` or `%`), so prose in Markdown does not count.
- The warning says some comments have no text: repeat it. The command skips them.
- An error from the CLI: apply the rules for reading errors in the conventions.
