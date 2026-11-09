# PMK-198: issue titles go through `--title-file` (design)

Size: a small change (three files of docs, one function, two tests). No questions were asked; the issue and its three acceptance criteria are the input.

## Intent
A title that comes from data (a TODO, a code comment, a user, an advisory) must never sit on the agent's shell command line: a backtick or `$(` runs as a command.

## Decisions (the author's calls)
1. Every `issues create --title "<title>"` in `commands/` becomes `--title-file <title file>`: `issues/todos.md`, `issues/capture.md`, `issues/create.md`, `issues/breakdown.md`, `issues/work.md`, `cycle/close.md`, `spec/import.md`. Each step says to write the title to its own one-line file outside `.issues/`.
2. `conventions.md` gets a rule: write title and description files with the file tool, never with `echo`, `printf` or a heredoc, because the text would come back to the shell. One line per title.
3. `alertCandidate` joins line breaks (and runs of whitespace) of an advisory title into one space, so `--title-file` does not fail with "more than one line".
4. A test fails when a command file has `issues create --title "`, and `conventions.md` is checked for the rule.

## Review round 1 (PR #125)
AC1 covers every command file, so the CLI got the flags: `epic create --title-file`, `docs next-adr --title-file`, `milestone create --name-file`, `release create --name-file` (for `local/doctor.md`). They share `lineFromFlag` in `scripts/pmkit.mjs` with `issues create --title-file`. `spec/import.md`, `spec/record-decision.md`, `local/doctor.md` and `issues/breakdown.md` use them. The plugin test now rejects `--title`, `--name` and `--description` with an inline value in any command file.

## Out of scope (follow-ups)
`issues list --text` is a search filter, not a title. `cycle open --goal` and `requests ... --reason` take free text from the user on the command line and have no `-file` flag.
