---
id: PMK-302
title: Refuse to delete the text an unclosed code fence takes into the Status section
type: bug
status: in_progress
priority: medium
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-302-refuse-to-delete-the-text-an-unclosed
created: 2026-11-13T16:20:45.230Z
updated: 2026-11-13T16:48:52Z
---

## Description

### Context

PMK-299 made `adr-status` refuse to write over a `## Status` section when an HTML block takes a heading into it (`adrHtmlHeld`). A fenced code block that is not closed does the same and is not caught. Checked at 7fee61b9:

- `## Status\n\n```\nAccepted\n\n## Context\n\nWhy.` reads the status as ```` ``` Accepted ## Context Why. ````, and `adr-status deprecated` writes `## Status\n\nDeprecated\n`: the Context section is deleted.
- `## Status\n\nAccepted\n\n~~~\n## Context\n\nWhy.` loses `## Context` the same way.
- A closed fence (```` ```\nAccepted\n``` ````) keeps the Context section.

Reading is right by CommonMark (an unclosed fence runs to the end of the document); deleting the user's text is not. Source: PMK-299, PR #253 (review cycle 1).

### Scope (in)

- `adr-status` refuses, with `INVALID_INPUT` and a next step (close the fence), to replace a Status section that an unclosed fence runs past a heading-looking line, dry run included, the way PMK-299 does for HTML blocks.
- `adr-get` says why the status holds that text.

### Out of scope

- Changing how the section is read.

### Tasks

- [ ] Detect an unclosed fence that runs past a heading-looking line in the Status section
- [ ] Refuse the write with a next step, and add the note to adr-get

## Acceptance criteria

- [x] `adr-status` on a Status section with an unclosed ``` or ~~~ fence before `## Context` writes nothing and gives a next step, with tests
- [x] `adr-get` on the same files names the cause in a note, with a test
- [x] `adr-status` on a Status section with a closed fence works as before, with a test
