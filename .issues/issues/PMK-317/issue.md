---
id: PMK-317
title: Write in place past a fence closed by the end of its quote or list item
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-317-write-in-place-past-a-fence-closed-by
created: 2026-11-14T15:52:57.253Z
updated: 2026-11-14T18:44:42Z
---

## Description

### Context

Since PMK-314, a fence or HTML block that closes after a status on a plain line of its own is written in place, since nothing is deleted. A fence that is closed by the end of the quote or list item that holds it, not by a closing line, is still treated as open. Checked at 46e15ecd:

- `Accepted`, a blank line, `> ```` `, `> ## X`, a blank line, `Date: 2024-01-02`: `adr-status` refuses with "setting the status would delete \"> ## X\", which the code fence \"```\" takes into the Status section" and the next step "close the code fence before the heading", and `adr-get` reads `Accepted` but notes that the fence "takes \"> ## X\" into the Status section". In CommonMark the blank line ends the quote, which closes the fence, so `## X` is code inside the quote and the in-place write keeps every line.
- The same with a list item: `Accepted`, blank, `- ```` `, `  ## X`, blank, `Date: 2024-01-02`.
- The HTML guard already gets this right: `> <!--`, `> ## X` in a quote that ends is written in place with no note.

`fenceRisk` (`scripts/lib/adr.mjs`) exempts only a fence block that has a closing line (`closer`). Source: PMK-314 (PR #283, review cycle 1).

### Scope (in)

- On the in-place write, a fence closed by the end of its quote or list item does not refuse and `adr-get` does not note it, as a fence closed by a closing line.

### Out of scope

- A whole-section replacement: the guard keeps refusing there.
- Which line is the status.

### Tasks

- [ ] Treat a fence that ends with its container as closed in the in-place guard and note

## Acceptance criteria

- [x] A status on a plain line followed by a fence in a quote, and in a list item, that ends with its container and holds a heading-like line is written in place, real and dry run, with no refusal and no note in `adr-get`, with tests
- [x] A fence in a quote or item that is still open at the next top-level heading keeps refusing, and the guard keeps refusing when the whole section would be replaced, with the existing tests passing
- [x] `scripts/dev/adr-commonmark-diff.mjs` run in full reports 0 worse, with the run in the PR
