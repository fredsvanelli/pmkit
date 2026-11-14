---
id: PMK-314
title: Keep a hard line break and skip guards that delete nothing in the in-place adr-status write
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-314-keep-a-hard-line-break-and-skip-guards
created: 2026-11-14T05:29:38.136Z
updated: 2026-11-14T06:15:37Z
---

## Description

### Context

PMK-311 made `adr-status` replace only the status line of a multi-line `## Status` section and keep the other lines, and made `adr-get` read that line as the status. Three parts of the PMK-299, PMK-302 and PMK-306 behaviour still assume the whole section is replaced. Checked at 5d09c170:

- The HTML block and code fence guards refuse a write that now keeps every line. `Accepted`, a blank line, then a closed comment `<!--`, `## X`, `-->`: `adr-status` refuses with "setting the status would delete \"## X\"" and the next step "close a comment with -->", though the comment is closed and the write would keep it; `adr-get` reads `Accepted` and still notes that the comment "takes \"## X\" into the Status section, so that text reads as part of the status". The same with a closed fence holding `## X`.
- A hard line break at the end of the status line is lost. `Accepted` with two trailing spaces, then `Date: 2024-01-02`, is written as `Deprecated` and the date line, so the date now renders on the status line. With a backslash break (`Accepted\`), `adr-get` reads the status as `Accepted\` and the write drops the backslash.
- The note "the line ... continues the paragraph of the status and is kept" fires for `***` and `___` after the status, which are thematic breaks, not a continuation.

Source: PMK-311 (PR #278, review cycles 2 and 3).

### Scope (in)

- When the in-place write applies, the HTML block and fence guards do not refuse it and `adr-get` does not note the held heading, since nothing is deleted and the status is read from one line; they keep refusing and noting when the whole section is replaced.
- The in-place write keeps a trailing hard line break (two or more spaces, or a backslash), and `adr-get` reads the status without it.
- The continuation note does not fire for a thematic break.

### Out of scope

- Which line is the status, and the cases refused as in develop.
- The refusal text of the list item and quote cases.

### Tasks

- [ ] Run the guards and their notes only when the whole section would be replaced
- [ ] Keep a hard line break on the status line
- [ ] Leave thematic breaks out of the continuation note

## Acceptance criteria

- [x] A closed HTML comment or a closed fence that holds a heading-like line after a status on a line of its own is written in place, real and dry run, with no refusal and no note in `adr-get`, with tests; the guards still refuse when the whole section would be replaced, with the existing tests passing
- [x] A status line that ends with a hard line break (two spaces, or a backslash) keeps it after the write, and `adr-get` reads the status without it, with tests
- [x] The continuation note does not name `***` or `___`, with a test
