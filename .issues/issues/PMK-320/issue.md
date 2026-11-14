---
id: PMK-320
title: Write in place past a fence its quote or list item closes at the heading or the end of the file
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-320-write-in-place-past-a-fence-its-quote-or
created: 2026-11-14T19:16:52.784Z
updated: 2026-11-14T20:04:36Z
---

## Description

### Context

Since PMK-317, a fence in a quote or list item that its container closes before a later line of the Status section is written in place, and `adr-get` does not note it. A fence whose container closes only at the heading that ends the section, or at the end of the file, still refuses, though CommonMark closes it there too and the in-place write keeps every line. Checked at 96bc3e5c:

- `Accepted`, a blank line, `> ```` `, `> ## X`, a blank line, `## Context`: `adr-status` refuses with "setting the status would delete \"> ## X\", which the code fence \"```\" takes into the Status section", and `adr-get` reads `Accepted` with a note that the fence "takes \"> ## X\" into the Status section". In CommonMark the blank line ends the quote and its fence, so `## X` is code in the quote and `## Context` ends the section.
- The same with a list item: `Accepted`, blank, `- ```` `, `  ## X`, blank, `## Context`.
- The same refusal when the container ends at the heading itself (`- ```` `, `  ## X`, `## Context` with no blank line) or at the end of the file (`> ```` `, `> ## X` as the last lines).
- The HTML guard already writes these in place with no note: `> <!--`, `> ## X` and `- <!--`, `  ## X` before `## Context`, and `> <!--`, `> ## X` at the end of the file.

A fence in a quote or list item cannot take a top-level heading: the heading is never a continuation of the container, so it closes the container and the fence at the latest. PMK-317 kept these cases refusing to leave the PMK-314 test unchanged (its criterion 2); this issue changes that test on purpose. Source: PMK-317 (PR #288, review cycles 1 and 2).

### Scope (in)

- On the in-place write, a fence in a quote or list item is closed when its container ends, whatever ends it (a later line, a blank line before the heading, the heading, the end of the file): no refusal, no note in `adr-get`, as the HTML guard.

### Out of scope

- A whole-section replacement: the guard keeps refusing there.
- A fence at the top level of the section that does not close: it keeps refusing.
- Which line is the status, and the refusal names (PMK-319).

### Tasks

- [ ] Treat a fence that ends with its container as closed at any end of the container
- [ ] Change the PMK-314 and PMK-317 tests that pin the refusal, naming the reason

## Acceptance criteria

- [x] A status on a plain line followed by a fence in a quote, and in a list item, that holds a heading-like line and whose container ends at a blank line before the heading, at the heading, or at the end of the file, is written in place, real and dry run, with no refusal and no note in `adr-get`, with tests (ATX and setext heading)
- [x] A top-level fence that does not close keeps refusing, and the guard keeps refusing when the whole section would be replaced (status in an item or quote, no known status line, two status lines), with the existing tests passing
- [x] A develop x branch comparison on random Status sections, checked against commonmark.js, shows the only new writes are this case and no new write deletes a line, and `scripts/dev/adr-commonmark-diff.mjs` run in full reports 0 worse, both in the PR
