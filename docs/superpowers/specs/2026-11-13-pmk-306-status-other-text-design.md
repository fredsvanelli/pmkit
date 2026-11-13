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
- `adrStatusOther(text)` (adr.mjs): trimmed non-blank lines of the section after the first paragraph (the status, which may span lines), found with the same `sectionEnd` walk. A first paragraph that holds a fence/comment (`` ```\nAccepted\n``` ``) stays "the status", as before.
- `runAdrStatus` collects html, fence and other (minus lines the first two already name) and throws one error; next step joins the steps of the causes found.
- Consequence: a closed comment or text in a paragraph before the status (`<!-- note -->\n\nAccepted`) is now refused, since the comment would be deleted. Two PMK-299 "writes as before" cases and one PMK-302 case change.
- `adrInfo` is untouched.
