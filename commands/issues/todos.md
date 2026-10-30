---
description: Turn the TODO and FIXME comments of the repository into issues, dropping the ones an issue already covers
argument-hint: "[path]"
disable-model-invocation: true
---

# Turn TODO and FIXME comments into issues

Arguments: `$ARGUMENTS`

## Parameters

- `path` (optional): one folder, such as `src/` (everything under it), or one file to scan instead of the whole repository. It must be inside the repository.

## Steps

Read `${CLAUDE_PLUGIN_ROOT}/skills/pmkit/references/conventions.md` first.

1. Scan the repository. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" todos scan [--path <path>] --json`. The CLI reads the files git lists, so it respects `.gitignore` and skips `node_modules`, the tracker folder, `.pmkit/`, symbolic links, binary files, files over 1 MiB and file types with no known comment syntax. It counts a TODO or FIXME only as the first word of a real comment, not in prose, strings or URLs. It groups a comment that repeats in several places into one candidate with every location, and it drops the candidates an existing issue matches, whatever that issue's status. A match is the `todo-key:` line of an issue this command created (`key`), or the comment text as whole words inside the issue title or text (`text`). A `file:line` never matches, because line numbers age. When `incomplete` is `true`, the tracker has more issues than the CLI read, so a comment that an issue covers may look new. Show the warning and stop before any create. When `skipped.unsupported` is not empty, the CLI printed a warning that lists the file types it did not read, such as `.txt (3)`. Show that warning before the preview, because a TODO in those files is not in the list. When `candidates` is empty, show the `matched` list, say there is nothing to create and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" discover --json` for the allowed types.
3. Draft one issue per candidate. The title is the candidate `title`. The type is `bug` for a FIXME and `task` for a TODO, when the tracker allows them, else the first allowed type. The description is the candidate `description` as it is, because its `todo-key:` line is what keeps a second run from creating the issue again. Write each description to a temporary file outside `.issues/`.
4. Run the dry run of each issue: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --description-file <file> --dry-run --json`. When a dry run fails, show the error and ask for a corrected value.
5. Show the full preview. First the `matched` comments as information (issue, status, reason, text), and say when a match is `done` or `canceled`, because its comment is still in the code. Then the candidates as a table (key, type, location, title), with `+n` for the extra locations of a repeated comment. This is a bulk create, so it always shows the full list and asks, whatever `write_policy.confirm` says. Ask with `AskUserQuestion` whether to create all of them. Let the user drop rows, edit titles and types, or move a `matched` row back to the creation list, which is the case when the match is wrong. A moved row uses its `title` and `description` from the scan, so it keeps its `todo-key:` line. Then show the list again, running the dry run again for each changed or moved row. When the user declines, stop and create nothing.
6. After the approval of step 5, create the issues in table order. For each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/pmkit.mjs" issues create --title "<title>" --type <type> --description-file <file> --json` and note the new ID. When one fails, stop, list what was created and what was not, and do not retry it.
7. Remove the temporary files.

## Confirmation points

- Step 4: a corrected value after a failed dry run.
- Step 5: the full list of issues to create, always asked because it creates more than one record. Declining creates nothing. Editing the list shows it again.

## Output

A table of the created issues (full ID, title, type, location), then the comments that already had an issue, with the issue ID and the reason. Mention that running the command again creates nothing for these comments, because each issue holds its `todo-key:` line.

## Known limits of the scan

The parser reads comment marks by file type. It is a heuristic, and these cases are known gaps, kept as a follow-up:

- Only the first word of a comment counts, so `// NOTE: TODO fix this` is not found.
- `@todo` tags and Python docstrings (`"""TODO: ..."""`) do not count.
- A comment inside a `<script>` or `<style>` block of an html, vue or svelte file is not read, because those files are read with the markup syntax.
- A stray quote on a line can hide a comment that follows it on the same line.
- A file type with no known comment syntax is not read. The warning of step 1 counts those files.

## If something is missing

- The CLI answers `INVALID_INPUT` because the folder is not a git repository: say the scan needs git to honor `.gitignore`, and stop.
- The CLI answers `NOT_CONFIGURED` because git is not installed: show the message and stop.
- `--path` is outside the repository (`../x`, an absolute path): the CLI answers `INVALID_INPUT`. Ask for a path inside it.
- The scan finds no `TODO` or `FIXME` comment: say so and stop. The tag must be the first word of a comment in a known language (JavaScript and TypeScript, Python, shell, Ruby, Go, Rust, CSS, HTML, YAML), and Markdown counts only inside `<!-- -->`.
- The warning says some comments have no text: repeat it. The command skips them.
- An error from the CLI: apply the rules for reading errors in the conventions.
