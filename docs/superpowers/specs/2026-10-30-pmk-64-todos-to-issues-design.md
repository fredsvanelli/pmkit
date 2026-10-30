# PMK-64 design: the todos-to-issues command

Issue PMK-64, epic EPC-6. Status: approved by the author's own choice (autonomous brainstorm, no questions to the user).

## Problem

The Dev catalog lists `todos-to-issues`: "TODO and FIXME become deduplicated issues". The Linear tab says it "deduplicates against existing issues and proposes new ones" and "creates after review". The acceptance criteria:

- Scans the repository for TODO and FIXME.
- Drops the ones that match an existing issue.
- Creates the rest after a full preview.

## Approaches

1. **A read-only CLI command `todos scan` plus a command file `/pmkit:issues:todos`.** The CLI scans and deduplicates. The command file previews and creates through `issues create`, as `breakdown` and `spec import` do.
2. **The command file alone, with the agent running `git grep`.** The scan and the matching rule would live in prose, so nothing tests them.
3. **A CLI command that also creates the issues.** A bulk write needs a preview that the command file already owns, and creating through `issues create` keeps every write validated and recorded.

Chosen: approach 1. It mirrors `alerts list` (reads the repository, never writes) and keeps the matching rule in tested code.

## Design

### Scan (my call)

`todos scan` reads the files git knows: `git ls-files -z --cached --others --exclude-standard` run in the repository root. This respects `.gitignore` and lists new files that are not committed yet. The command then drops:

- paths under `.issues/` and `node_modules/`, and `.pmkit/`;
- files over 1 MiB;
- binary files (a NUL byte in the first 8000 bytes);
- files that are listed but missing on disk (a deleted file that is not staged).

The git call uses a 256 MiB `maxBuffer`, as `MAX_OUTPUT` does in the GitHub host, and no timeout on a read it can finish. A repository that is not a git repository fails with `INVALID_INPUT`, because there is no way to honor `.gitignore`.

A TODO is a `TODO` or `FIXME` in capitals that is the first word of a comment, then an optional `(owner)`, an optional `:` and the text (see "Changes after review" for the comment rules). A word like `TODOS` or `TODO-1` does not match. A TODO with no text is skipped and counted in `skippedEmpty`.

### Identity and matching (my call)

The normalized text is the text lowercased, with whitespace collapsed and surrounding punctuation trimmed. The key is the first 12 hex characters of the SHA-256 of the normalized text. The tag (TODO or FIXME) and the owner are not part of the key, so changing `TODO` to `FIXME` does not create a duplicate.

Repeats in the same scan share a key, so they become one candidate with every location listed (`locations: ["src/a.mjs:12", "src/b.mjs:40"]`, in path then line order). The candidate tag is FIXME when any location is a FIXME, else TODO.

A candidate matches an existing issue, whatever its status or archived flag, when one of these holds. The first that holds is the reason. A `file:line` never matches.

1. `key`: the issue description or body has the line `todo-key: <key>`. Issues this command creates carry it, so a second run creates nothing.
2. `text`: the normalized title, description or body contains the normalized text as whole words, and the text is at least 15 characters. The minimum stops a short text such as `fix` from matching everything.

Matching reads closed and archived issues too, so a TODO whose issue is `done` still shows as matched (reason and issue status are in the data). The user sees the case and decides. This is my call: a done issue with the TODO still in code is a signal, but creating a duplicate silently is worse.

### Command

`todos scan` reads only. Data:

```
{ files: n, skippedEmpty: n, incomplete: false, skipped: { unsupported: { ".txt": 3 } },
  candidates: [{ key, tag, text, locations, title, description }],
  matched: [{ key, tag, text, locations, title, description, issue: "ISS-1", status: "done", reason: "key" }] }
```

`title` is the text cut to 80 characters (a cut ends in `...`). `description` is the text the new issue gets:

```
<text>

Source: `src/a.mjs:12`
Also at: `src/b.mjs:40`

todo-key: <key>
```

Text output is a table of candidates (key, tag, location, text) and a table of matched ones (issue, status, reason, text), or `no TODO or FIXME found`. A bad issue file in the tracker is a warning, as in `issues list`. The command needs `.pmkit/config.yaml` and the tracker (to read the issues), so it gives the same output on every tracker.

### Command file

`commands/issues/todos.md` is `/pmkit:issues:todos [path]`. It runs `todos scan`, shows the matched ones as information and the candidates as a table, lets the user drop rows or edit a title, and always asks before creating (a bulk write, whatever `write_policy.confirm` says). After approval it runs `issues create` with `--description-file` for each candidate, dry run first, and stops at the first failure. One candidate alone still shows the full preview. An optional `path` argument limits the scan to one folder or one file, passed as `--path`.

### Capability manifest

No capability changes. The command reads the repository and the tracker, and no manifest entry describes it, so `capabilities.mjs` and the golden `capabilities.txt` files stay as they are. This keeps the rebase small next to PMK-45, PMK-62 and PMK-71.

### Testing

Unit tests cover the line parser, the normalization and key, the grouping, and the matching reasons. CLI tests use a temporary git repository: `.gitignore` respected, `node_modules`, `.issues`, binary files and big files skipped, repeats grouped, the three match reasons, a second run after creating an issue from a candidate returning nothing to create, and a non-git directory refused. A test runs the scan with 20000 lines of output to check the `maxBuffer`. Goldens record the non-git refusal in the fixtures.

### Non-goals

Blame or owner lookups, other tags (HACK, XXX), removing the TODO from the code after the issue exists, labeling the issue, and a full parser for every language (see "Known limits").

## Open choices for the builder

None that need the author.

## Calls made while building

- The command file gives a FIXME the type `bug` and a TODO the type `task`, when the tracker allows them.
- The command file runs the dry runs before the preview and asks once after it, so the user sees records that already passed validation.
- `--path` drops a leading `./`.

## Changes after review

- **Comments are parsed, not matched by line.** `findTodos(source, file)` picks the comment syntax from the file name: `//` and `/* */` for js, mjs, cjs, jsx, ts, tsx, java, kt, swift, c, cpp and cs; `//`, `/* */` and character literals for go and rs; `/* */` for css; `#` for py (with triple quotes), sh, bash, zsh, rb, yaml, yml, toml, Makefile and Dockerfile; `<!-- -->` for html, xml, svg and vue; and `<!-- -->` only for md, with fenced code and inline code blanked first. A file type not listed is not read.
- **A mark inside a string is not a comment.** `//` after a colon (a URL) is not a mark, and `#` counts only at the start of a line or after a space. Template literals, Python triple quotes and Go raw strings can span lines.
- **The tag is the first word of the comment**, so the first tag wins (`// FIXME: TODO items` is a FIXME with the text `TODO items`) and prose that names a TODO in passing is not one. `TODO:fix` with no space counts.
- **No `file:line` match.** An issue that lists an old line does not cover a new comment on that line. The matches are `key`, and `text` on whole words. A moved-back row of `matched` keeps its `title` and `description` in the data.
- **The tracker read is complete or flagged.** `readExistingIssues` asks for up to 100000 issues, which makes the Linear adapter read every page. A read the tracker cut, or one that reached the limit, sets `incomplete: true` in the data and prints a warning. The command file stops before any create.
- **The scan never follows symbolic links** (`lstat`), skips the tracker folder from the config (`tracker.path`) in place of a fixed `.issues/`, and answers `INVALID_INPUT` for a `--path` outside the repository. `--path src` matches `src/` and `src` but not `src2/`.
- **A missing git** answers `NOT_CONFIGURED` with the message "git was not found".
- A test scans the pmkit repository and expects no candidate.

## Changes after the second review

- A file with CRLF line endings is read: `findTodos` turns `\r\n` into `\n` first, as `config.mjs` does for YAML.
- The scan counts the files it did not read because their type has no comment syntax, by extension (or by file name when there is none), in `skipped.unsupported`. The text prints a warning, and the command file shows it before the preview.
- More types: php and Terraform (`//` and `#`), scala, dart, gradle, kts, scss and less (as JavaScript), svelte (as html), r, pl, ex, exs, ps1, mk, Containerfile, Gemfile and Rakefile (`#`), and sql, lua and hs (`--`).
- Matching builds one index of the issues (the `todo-key` lines in a map, and the issues per word of the normalized text) and checks each candidate against the issues that share its rarest word. The first issue in list order still wins.
- `--path` takes one folder (with everything under it) or one file inside the repository, not a text prefix.
- The test that looks for false candidates reads only the docs, tests and library that quote these comments on purpose. It does not forbid a real TODO elsewhere and does not read untracked files. This replaces the whole-repository scan of the first review.

## Known limits

These are gaps of the parser. They stay as a follow-up and are not solved here.

- Only the first word of a comment counts, so `// NOTE: TODO fix this` is not found.
- `@todo` tags and Python docstrings do not count.
- A comment inside a `<script>` or `<style>` block of an html, vue or svelte file is not read.
- A stray quote on a line can hide a comment that follows it on the same line.
- A file type with no known comment syntax is not read. The warning lists those files.
