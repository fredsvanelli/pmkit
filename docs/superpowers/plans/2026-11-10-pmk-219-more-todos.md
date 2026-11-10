# PMK-219 More TODOs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `todos scan` finds `HACK`, `XXX`, `@todo`, docstrings, `<script>`/`<style>` comments and comments after a lone quote, and warns only about file types that can hold a comment it cannot read.

**Architecture:** All parsing stays in `scripts/lib/todos.mjs` (`commentLines`, `findTodos`, `groupTodos`, `scanRepo`). The CLI entry in `scripts/pmkit.mjs` only changes its wording and the warning. The command file and docs follow.

**Tech Stack:** Node.js ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-10-pmk-219-more-todos-design.md`

## Global Constraints

- Tags: `TODO`, `FIXME`, `HACK`, `XXX` (upper case, first word); `@todo`, `@fixme`, `@hack`, `@xxx` in any case, reported upper case.
- Group tag rank: `FIXME` > `XXX` > `HACK` > `TODO`.
- Command type: `bug` for `FIXME` and `XXX`, `task` for `TODO` and `HACK`.
- `todoKey` and the description format do not change.
- The warning lists at most 10 types, then `and N more types`.
- Every commit carries `(PMK-219)` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A docstring after code (`s = """TODO"""`) must stay a string: test in Task 2.
- A `'` inside a closed string or a Rust char literal must keep working: existing tests in `scripts/todos.test.mjs` stay green.
- `//` inside a CSS `url(//cdn)` of a plain `<style>`: Task 2 reads it with the CSS syntax, test asserts no hit.
- A `<script>` element with a TODO gives the right line number in the html file: test in Task 2.
- The self-scan of this repository (docs and tests quote the new tags) stays empty: Task 4 adds the new spec and plan to that test's list.

---

### Task 1: More tags and their rank

**Files:** Modify `scripts/lib/todos.mjs` (`TAG`, `findTodos`, `groupTodos`); Test `scripts/todos.test.mjs`.

**Interfaces:** Produces `findTodos(source, file) -> { line, tag, owner, text }[]` with `tag` one of the four names.

- [ ] Step 1: failing test `findTodos reads HACK, XXX and @todo tags`: `tags('// HACK: skip the cache', 'a.mjs')` is `[[1, 'HACK', 'skip the cache']]`; `tags('# XXX broken on windows', 'a.py')` is `[[1, 'XXX', 'broken on windows']]`; `tags('/**\n * @todo add paging\n * @TODO(ana): x\n */', 'a.ts')` is `[[2, 'TODO', 'add paging'], [3, 'TODO', 'x']]`; `// XXXL size`, `// @todos` and `// hack: lower` give `[]`. Test `groupTodos keeps the strongest tag`: TODO + HACK gives HACK, HACK + XXX gives XXX, XXX + FIXME gives FIXME.
- [ ] Step 2: `node --test scripts/todos.test.mjs` fails on them.
- [ ] Step 3: `TAG` takes the four names; a second regex `AT_TAG` (`i` flag) reads `@name`; `groupTodos` keeps the tag with the highest index in `['TODO', 'HACK', 'XXX', 'FIXME']`.
- [ ] Step 4: tests pass. Step 5: commit.

### Task 2: Parser: lone quotes, docstrings, `<script>` and `<style>`

**Files:** Modify `scripts/lib/todos.mjs` (`commentLines`, `STYLES`, `findTodos`); Test `scripts/todos.test.mjs`.

- [ ] Step 1: failing tests.
  - `a lone quote does not hide a comment`: `tags("title: it's done # TODO: x", 'a.yaml')` is `[[1, 'TODO', 'x']]`; `tags("const re = /'/ // TODO: after a regex", 'a.mjs')` is `[[1, 'TODO', 'after a regex']]`; `findTodos("s = 'a # TODO: no'", 'a.py')` stays `[]`; `findTodos("x = 'it\\'s # TODO: no'", 'a.py')` stays `[]`.
  - `a Python docstring reads like a block comment`: `tags('def f():\n    """TODO: docstring"""\n', 'a.py')` is `[[2, 'TODO', 'docstring']]`; `tags('"""Module.\n\nFIXME: second line\n"""\n', 'a.py')` is `[[3, 'FIXME', 'second line']]`; `findTodos('s = """\nTODO: in a string\n"""', 'a.py')` is `[]`. The old assertion on `'"""\n# TODO: docstring\n"""'` is replaced by this last one.
  - `script and style elements read with their own syntax`: in `a.html`, `'<p>x</p>\n<script>\nconst a = 1 // TODO: js\n</script>\n<style>\n/* FIXME: css */\na { background: url(//cdn.x/y.png) }\n</style>\n<!-- HACK: markup -->\n'` gives `[[3, 'TODO', 'js'], [6, 'FIXME', 'css'], [9, 'HACK', 'markup']]`; in `a.vue`, `'<style lang="scss">\n// TODO: scss\n</style>'` gives `[[2, 'TODO', 'scss']]`; in `a.html`, `'<script>const s = "<!-- TODO: no -->"</script>'` gives `[]`; in `README.md`, `'<script>\n// TODO: no\n</script>'` gives `[]`.
- [ ] Step 2: they fail.
- [ ] Step 3:
  - In `commentLines`, a single quote other than a backtick or a triple quote opens a string only when its closing quote is on the same line (a backslash skips the next character, an escaped newline continues); otherwise the quote is code.
  - `py` gets `docstrings: true`: a triple quote with only spaces before it on its line opens a block that the same triple quote closes.
  - `markup` gets `embedded: true`. `findTodos` finds each `<script ...>` and `<style ...>` element (regex with the `d` flag), reads its inner text with `STYLES.c` (script, or style with `lang` scss, less, sass or stylus) or `STYLES.css`, adds the line offset, blanks the inner text (newlines kept) for the markup pass, and sorts the result by line.
- [ ] Step 4: all of `scripts/todos.test.mjs` passes. Step 5: commit.

### Task 3: Quiet warning

**Files:** Modify `scripts/lib/todos.mjs` (`EXTENSIONS`, `BY_NAME`, `scanRepo`), `scripts/pmkit.mjs` (todos scan); Test `scripts/cli-todos.test.mjs`, `scripts/todos.test.mjs`.

**Interfaces:** Produces `scanRepo(...).skipped = { unsupported: { [type]: count }, noComments: { [type]: count } }`.

- [ ] Step 1: failing tests. Rewrite `todos scan counts the files it cannot read by type and warns`: files `a.mjs`, `notes.txt`, `more.txt`, `data.JSON` (`{ // TODO: jsonc\n}`), `LICENSE`, `.gitignore` (`# TODO: ignore rule`), `x.clj`, `node_modules/x/y.txt` give `skipped` `{ unsupported: { '.clj': 1 }, noComments: { '.txt': 2, LICENSE: 1 } }`, candidates `build the export`, `ignore rule`, `jsonc`, a warning `1 files .*not read.*\.clj \(1\)` with no `.txt` in it. New test: 12 unsupported types (`a.t1` .. `a.t12`) give a warning that ends with `and 2 more types`. Empty repo text says `no TODO, FIXME, HACK or XXX found`.
- [ ] Step 2: they fail.
- [ ] Step 3: `json`, `jsonc`, `json5` go to the C-like list; the four dotfiles go to `BY_NAME` with `STYLES.hash`; a `NO_COMMENTS` set holds the spec's types (`.txt`, `.jsonl`, `.ndjson`, `.csv`, `.tsv`, `.log`, `.lock`, `.gitkeep`, `.keep`, `LICENSE`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`, `.webp`, `.bmp`, `.pdf`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`, `.zip`, `.gz`, `.tgz`); the CLI warning slices to 10 types; texts in `pmkit.mjs` name the four tags.
- [ ] Step 4: `node --test scripts/cli-todos.test.mjs scripts/todos.test.mjs` passes. Step 5: commit.

### Task 4: Command file and docs

**Files:** Modify `commands/issues/todos.md`, `README.md`, `skills/pmkit/SKILL.md`, `CHANGELOG.md`, `scripts/cli-todos.test.mjs` (self-scan list).

- [ ] Step 1: add the new spec and plan to the self-scan file list; run it, expect pass.
- [ ] Step 2: `todos.md`: description and title name the four tags; step 1 names `skipped.noComments` (no warning) and the tags; step 3 maps `bug` for FIXME and XXX, `task` for TODO and HACK; the Known limits list matches the spec's non-goals; the empty case lists the tags and the new syntaxes. README line 44 and the `todos scan` row, SKILL.md row, one CHANGELOG line at the top of `## Unreleased`.
- [ ] Step 3: `npm test` in the foreground, exit code 0. Step 4: commit.
