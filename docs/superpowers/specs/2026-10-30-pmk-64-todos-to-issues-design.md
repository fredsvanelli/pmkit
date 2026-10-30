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

A line is a TODO when it has a comment leader (`//`, `#`, `/*`, `*`, `<!--`, `--`, `;`, `%`) followed later on the line by `TODO` or `FIXME` in capitals as a whole word, then an optional `(owner)`, an optional `:` and the text. The leader rule keeps prose such as "TODO and FIXME become issues" in docs from matching, and a word like `TODOS` does not match. The text is the rest of the line without a trailing `*/` or `-->`. A TODO with no text is skipped and counted in `skippedEmpty`.

### Identity and matching (my call)

The normalized text is the text lowercased, with whitespace collapsed and surrounding punctuation trimmed. The key is the first 12 hex characters of the SHA-256 of the normalized text. The tag (TODO or FIXME) and the owner are not part of the key, so changing `TODO` to `FIXME` does not create a duplicate.

Repeats in the same scan share a key, so they become one candidate with every location listed (`locations: ["src/a.mjs:12", "src/b.mjs:40"]`, in path then line order). The candidate tag is FIXME when any location is a FIXME, else TODO.

A candidate matches an existing issue, whatever its status or archived flag, when one of these holds. The first that holds is the reason.

1. `key`: the issue description or body has the line `todo-key: <key>`. Issues this command creates carry it, so a second run creates nothing.
2. `source`: the description or body contains one of the candidate's `file:line` locations.
3. `text`: the normalized title, description or body contains the normalized text, and the text is at least 15 characters. The minimum stops a short text such as `fix` from matching everything.

Matching reads closed and archived issues too, so a TODO whose issue is `done` still shows as matched (reason and issue status are in the data). The user sees the case and decides. This is my call: a done issue with the TODO still in code is a signal, but creating a duplicate silently is worse.

### Command

`todos scan` reads only. Data:

```
{ files: n, skippedEmpty: n,
  candidates: [{ key, tag, text, locations, title, description }],
  matched: [{ key, tag, text, locations, issue: "ISS-1", status: "done", reason: "key" }] }
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

`commands/issues/todos.md` is `/pmkit:issues:todos [path]`. It runs `todos scan`, shows the matched ones as information and the candidates as a table, lets the user drop rows or edit a title, and always asks before creating (a bulk write, whatever `write_policy.confirm` says). After approval it runs `issues create` with `--description-file` for each candidate, dry run first, and stops at the first failure. One candidate alone still shows the full preview. An optional `path` argument filters locations by prefix, passed as `--path`.

### Capability manifest

No capability changes. The command reads the repository and the tracker, and no manifest entry describes it, so `capabilities.mjs` and the golden `capabilities.txt` files stay as they are. This keeps the rebase small next to PMK-45, PMK-62 and PMK-71.

### Testing

Unit tests cover the line parser, the normalization and key, the grouping, and the matching reasons. CLI tests use a temporary git repository: `.gitignore` respected, `node_modules`, `.issues`, binary files and big files skipped, repeats grouped, the three match reasons, a second run after creating an issue from a candidate returning nothing to create, and a non-git directory refused. A test runs the scan with 20000 lines of output to check the `maxBuffer`. Goldens record the non-git refusal in the fixtures.

### Non-goals

Blame or owner lookups, other tags (HACK, XXX), removing the TODO from the code after the issue exists, labeling the issue, comment parsing per language.

## Open choices for the builder

None that need the author.
