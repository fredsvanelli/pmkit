---
id: PMK-323
title: Write in place past an HTML block its quote or list item holds at the end of the file
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-323-write-in-place-past-an-html-block-its
created: 2026-11-14T20:46:32.738Z
updated: 2026-11-14T23:11:53Z
---

## Description

### Context

Since PMK-314 the in-place write refuses only an HTML block of kind 1 to 5 that is still open at the end of the walk (`held.unclosed`), and since PMK-320 the fence guard counts only a fence open at the top level of the document (`held.openFence`). The HTML guard still counts a block open inside a quote or list item at the end of the file, though nothing comes after it to take. Checked with the CLI at bac7dc92 (`Accepted`, blank, then the lines below as the end of the file):

- `> <!--`, `> ## X` with no final newline: `adr-status` refuses with `would delete "> ## X", which the HTML block "<!--" takes into the Status section` and `adr-get` adds the same note. With a final newline the trailing blank line ends the quote and it writes in place with no note.
- `- <!--`, `  ## X`: refuses with and without a final newline (a blank line does not end a list item).
- The same for the other kinds 1 to 5: `<?php`, `<![CDATA[`, `<!X`, `<script>`. Kind 6 (`<div>`) writes.
- A fence in the same places writes in place with no note (PMK-320), and `- <!--`, `  ## X`, blank, `## Context` writes too.

Root cause: `sectionEnd` in `scripts/lib/adr.mjs` sets `held.unclosed` from the innermost open block whatever holds it, while `held.openFence` takes only a fence directly in the document. Source: PMK-320 (PR #293, implementer follow-up and review cycle 1).

### Scope (in)

- On the in-place write, an HTML block of kind 1 to 5 in a quote or list item that is open at the end of the file is not refused and gets no `adr-get` note, as the fence guard.

### Out of scope

- A whole-section replacement: the guard keeps refusing there.
- An HTML block of kind 1 to 5 at the top level of the section that never closes: it keeps refusing.

### Tasks

- [ ] Count as unclosed only an HTML block open at the top level of the document at the end of the walk
- [ ] Tests for a quote and a list item, with and without a final newline, for kinds 1 to 5

## Acceptance criteria

- [x] A status on a plain line followed by an HTML block of kind 1 to 5 in a quote, and in a list item, that holds a heading-like line and is open at the end of the file, with and without a final newline, is written in place, real and dry run, with no refusal and no note in `adr-get`, with tests
- [x] A top-level HTML block of kind 1 to 5 that never closes keeps refusing, and the guard keeps refusing when the whole section would be replaced, with the existing tests passing
- [x] A develop x branch comparison on random Status sections, checked against commonmark.js, shows the only new writes are this case and no new write deletes a line, and `scripts/dev/adr-commonmark-diff.mjs` run in full reports 0 worse, both in the PR
