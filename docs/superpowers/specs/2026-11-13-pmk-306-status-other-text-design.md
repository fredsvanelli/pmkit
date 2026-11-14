# PMK-306: adr-status never deletes the other text of the Status section

## Intent
`docs adr-status` replaces the whole body of `## Status`. PMK-299 and PMK-302 refuse when an HTML block or a fence takes a heading into the section; any other text (a rationale paragraph, text after a fence that never closes, a line indented 4 spaces) was deleted without a word, and the HTML guard hid the fence guard (first cause only).

## Goals
- Never delete text of the section besides the status without saying so, dry run included.
- One `INVALID_INPUT` refusal names every cause (HTML block, fence, other text), with one next step covering all; nothing written.
- A section that holds only the status writes as before.

## Non-goals
- How `adr-get` reads the section (still the whole body joined). The HTML and fence rules themselves.

## Approaches
1. Keep the text, write only the status. Rejected: `adrInfo`/`adr-get` read the whole body as the status (`Accepted Why this was chosen.`), so after a write the status would read `Deprecated Why this was chosen.`; fixing that changes the reading, which is out of scope, and the kept text may now contradict the new status.
2. Refuse (chosen). Simple, never loses text, reading and writing stay in agreement. Cost: a real ADR with a rationale in Status needs the text moved by hand first; the next step says so.
3. Refuse only on fence/HTML causes. Rejected: leaves the plain-paragraph loss in the issue.

## Design
- `adrStatusDropped(text)` (adr.mjs): the trimmed non-blank lines `setAdrStatus` deletes from the section besides the status line, read from the same slice (`statusBody`) the write replaces, so the guard is exactly what the write deletes (review cycle 1: a guard that looked only after the first blank line missed `Accepted\n- Supersedes ADR 3`, `Accepted\n> n`, `Accepted\n<!-- x -->`, a glued fence and a lazy line). The status line is the first line that does not open a block (comment, quote, list item, fence, heading, table), else the first; so for `<!-- note -->\n\nAccepted` the refusal names the comment, not the status.
- `runAdrStatus` collects html, fence and other (the dropped lines minus one occurrence per line the first two name, by position of occurrence), and throws one error; the next step joins the fixes of the causes found with one "then run the command again".
- Consequences (all refused now, all deleted text before): a comment or text before the status; a closed fence around the status (`` ```\nAccepted\n``` ``); a list item, quote, comment, fence or lazy line glued to the status.
- Cost for `/pmkit:spec:record-decision`, which calls `adr-status ... superseded --by N`: MADR ADRs (`Accepted` plus a date line) and Nygard ADRs (`Accepted` plus `Supersedes ...`) in the Status section are refused. The command file tells the agent to show the refusal and next step, never to edit the ADR, and to offer `/pmkit:spec:adr-status` after the user moves the text. Keeping the text (writing only the status) is the follow-up that removes this cost; it needs `adrInfo` and `adr-get` to read the status as one line, which is out of scope.
- `adrInfo` is untouched.
