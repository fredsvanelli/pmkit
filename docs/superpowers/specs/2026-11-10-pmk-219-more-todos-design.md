# PMK-219: find more TODOs in todos-to-issues

## Intent

`todos scan` (PMK-64, PMK-182) misses comments a developer would call a TODO, and its warning about unread files is noise in a normal repository (this one: 626 files, 571 of them `.txt` goldens). PMK-219 widens what the scan finds and makes the warning list only files that could hold a comment the scan cannot read. The owner, `git blame` and the `todo-key` field are PMK-238, not this issue.

## Goals

1. **More tags.** `HACK` and `XXX` count, as the first word of a comment, like `TODO` and `FIXME`.
2. **A better parser.**
   - The `<script>` and `<style>` elements of html, vue, svelte and svg files are read (an xml file stays plain markup: its `<style>` is Android data and its `<script>` an Ant task) with their own syntax: JavaScript for a script with no `type` or a JavaScript `type` (any other script, a self-closing element and one with no closing tag stay markup), CSS for a style (C-like for `lang="scss"`, `less`, `sass` or `stylus`).
   - A lone quote (one with no closing quote on its line) no longer hides the comment after it, so `title: it's done # TODO: x` in YAML and `const re = /'/ // TODO: x` in JavaScript are found.
   - `@todo` (any case, also `@fixme`, `@hack`, `@xxx`), the JSDoc and PHPDoc tag, counts. Its tag is the upper-case name.
   - A Python docstring is read like a block comment: a triple-quoted string that starts its line (only spaces before it). A triple-quoted string after code (`s = """..."""`) stays a string.
3. **A quiet warning.**
   - File types that have no comments by nature (`.txt`, `.jsonl`, `.ndjson`, `.csv`, `.tsv`, `.log`, `.lock`, `.gitkeep`, `.keep`, `LICENSE`, images, fonts, archives, PDF) are not counted as unread. JSON reports them in `skipped.noComments`, by type, and no warning names them.
   - `.json`, `.jsonc` and `.json5` are read with the C-like syntax (a `tsconfig.json` holds `//` comments; strict JSON has no comment, and its strings are skipped).
   - `.gitignore`, `.gitattributes`, `.dockerignore` and `.npmignore` are read with the `#` syntax.
   - The warning lists at most 10 types, then `and N more types`.

## Decisions (my calls, from PEP 350 and the existing code)

- Type of the issue: `bug` for `FIXME` and `XXX`, `task` for `TODO` and `HACK`. PEP 350 lists `XXX` as an alias of `FIXME` and `HACK` as a workaround, which is debt, not a defect.
- A repeated comment with several tags keeps the strongest: `FIXME` > `XXX` > `HACK` > `TODO` (today `FIXME` wins over `TODO`).
- The `todo-key` stays the hash of the text only, so the keys of existing issues do not change.
- Markdown stays prose: only `<!-- -->` counts, its `<script>` elements are not read.

## Non-goals

- The owner of a TODO, the reference back to the issue, the `todo-key` field: PMK-238.
- A real parser per language. The scan stays a heuristic, and the command file keeps a "Known limits" list: only the first word counts; two apostrophes on one line still make a string; a `>` inside a quoted attribute of a `<script>` or `<style>` tag ends the tag; a triple-quoted string that starts a line inside an expression reads as a docstring.

## Anti-goals

- A change that makes the self-scan of this repository find a comment: `scripts/cli-todos.test.mjs` scans the docs, tests and library that quote tags on purpose and must stay empty.
- A change in the keys of comments that already have an issue.

## Surfaces to update

`scripts/lib/todos.mjs`, `scripts/pmkit.mjs` (summary, empty text, warnings), `commands/issues/todos.md` (steps 1 and 3, known limits, the empty case), `README.md` (command line and the `todos scan` row), `skills/pmkit/SKILL.md`, `CHANGELOG.md`, tests in `scripts/todos.test.mjs` and `scripts/cli-todos.test.mjs`. No new command, so no scenario count changes.
