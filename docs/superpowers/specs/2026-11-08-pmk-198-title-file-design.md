# PMK-198: issue titles go through `--title-file` (design)

Size: a small change (three files of docs, one function, two tests). No questions were asked; the issue and its three acceptance criteria are the input.

## Intent
A title that comes from data (a TODO, a code comment, a user, an advisory) must never sit on the agent's shell command line: a backtick or `$(` runs as a command.

## Decisions (the author's calls)
1. Every `issues create --title "<title>"` in `commands/` becomes `--title-file <title file>`: `issues/todos.md`, `issues/capture.md`, `issues/create.md`, `issues/breakdown.md`, `issues/work.md`, `cycle/close.md`, `spec/import.md`. Each step says to write the title to its own one-line file outside `.issues/`.
2. `conventions.md` gets a rule: write title and description files with the file tool, never with `echo`, `printf` or a heredoc, because the text would come back to the shell. One line per title.
3. `alertCandidate` joins line breaks (and runs of whitespace) of an advisory title into one space, so `--title-file` does not fail with "more than one line".
4. A test fails when a command file has `issues create --title "`, and `conventions.md` is checked for the rule.

## Out of scope (follow-ups)
`epic create --title`, `milestone create --name`, `docs next-adr --title`, `issues find --text` and `local/doctor.md`'s `--name` also take data on the command line, but their CLI commands have no `-file` flag. Adding one is a CLI change, so it is a separate issue.
