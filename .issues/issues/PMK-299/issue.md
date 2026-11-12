---
id: PMK-299
title: Refuse to delete the text an unclosed HTML block takes into the Status section
type: bug
status: in_progress
priority: medium
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-299-refuse-to-delete-the-text-an-unclosed
created: 2026-11-12T22:25:14.150Z
updated: 2026-11-12T23:09:30Z
---

## Description

### Context

Since PMK-291, `sectionEnd` (`scripts/lib/adr.mjs`) follows CommonMark's HTML blocks. An HTML block in the Status section that does not end before the next heading takes that heading in: `<!-- note` without `-->` runs to the end of the file, and `<div>` or `<custom-tag>` (types 6 and 7) run to the next blank line. Checked at 7f26b46:

- `## Status\n\n<!-- note\nAccepted\n\n## Context\n\nWhy we did it.` gives the status `<!-- note Accepted ## Context Why we did it.`, and `adr-status deprecated` writes `## Status\n\nDeprecated\n`: the Context section is deleted.
- `## Status\n\n<div>\n## Context\n\nWhy.` and the same with `<custom-tag>` also lose `## Context`.

Reading is right by CommonMark; deleting the user's text is not. Source: PMK-291, PR #241 (review cycle 5).

### Scope (in)

- `adr-status` never deletes a line that reads as an ATX heading, or that the HTML block took in, from the section it replaces: it refuses with a next step (close the comment, or add a blank line after the HTML line).
- `adr-get` says why the status holds that text.

### Out of scope

- Changing how the section is read.

### Tasks

- [ ] Detect an HTML block that runs past a heading-looking line in the Status section
- [ ] Refuse the write with a next step, and add the note to adr-get

## Acceptance criteria

- [x] `adr-status` on a Status section with an unclosed `<!--`, `<div>` or `<custom-tag>` before `## Context` writes nothing and gives a next step, with tests
- [x] `adr-get` on the same files names the cause in a note, with a test
- [x] `adr-status` on a Status section with a closed HTML comment works as before, with a test
