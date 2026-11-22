---
id: PMK-329
title: Skip a quote of definitions and keep a shown line in the adr-status fallback
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-329-skip-a-quote-of-definitions-and-keep-a
created: 2026-11-15T23:21:51.096Z
updated: 2026-11-22T01:56:54Z
---

## Description

### Context

Since PMK-325 the `adr-status` refusal finds the first paragraph the reader sees past link reference definitions, also across a quote or list item. Two shapes still keep a line the reader does not see as the status. Only names are wrong; nothing refused, written or read changes. Checked with the CLI at b3533a59, against commonmark.js 0.31.2:

- **A quote holding only definitions**, closed by a blank line. `> [a]: /u`, blank, `> Date: x`, `> Accepted`, blank, `> Proposed` keeps `> Proposed` and names `"> [a]: /u", "> Date: x", "> Accepted"`; with no later status it keeps the hidden `> [a]: /u` and names `"> Date: x", "> Accepted"`. Without the definition both keep `> Accepted`. commonmark.js renders an empty `<blockquote>` (nothing shown), then `<p>Date: x Accepted</p>` in a second quote.
- **The first-line fallback with no line that reads as a status.** `[a]: /u`, blank, `Date: x`, `Foo` keeps the hidden `[a]: /u` and names `"Date: x", "Foo"`; `Date: x`, `Foo` keeps `Date: x`. commonmark.js renders `<p>Date: x Foo</p>`. PMK-322 pinned this shape (`scripts/adr.test.mjs`, `a definition over two lines with no later status`: `[Draft]:`, `Rejected`, blank, `see ADR 3` keeps `[Draft]:`), before PMK-325 set that a hidden definition is never kept as the status; that test changes on purpose to keep `see ADR 3`.

Not this case: a list item holding only definitions renders an empty `<li>` whose bullet the reader sees, so `- [a]: /u`, blank, `- Date: x`, `  Accepted`, blank, `> Proposed` keeps `> Proposed` as now, like any shown block before the paragraph.

Source: PMK-325 (PR #302, review cycles 1 and 2).

### Scope (in)

- In the walk of `statusSection` (`scripts/lib/adr.mjs`): a quote whose blocks are all hidden is hidden too, so the paragraph after it is the first one shown.
- With no line that reads as a status, the fallback keeps the first line the reader sees, never a hidden definition.
- One tracker of hidden blocks: derive `hidden` from `runs` (PMK-325 review note).

### Out of scope

- A list item holding only definitions (its bullet is shown), and any other shown block before the paragraph: the fallback stays.
- What is refused, written or read: only names change.

### Tasks

- [ ] Treat a quote of hidden blocks as hidden in the walk, and keep the first shown line in the fallback
- [ ] Derive `hidden` from `runs`
- [ ] Tests for the cases above, and the PMK-322 test changed on purpose

## Acceptance criteria

- [x] `> [a]: /u`, blank, `> Date: x`, `> Accepted`, with and without a blank and `> Proposed` after, keeps `> Accepted` and names every other line, as with no definition, real and dry run, with tests; the list item holding only definitions keeps its names, with a test
- [x] With no line that reads as a status, `[a]: /u`, blank, `Date: x`, `Foo` keeps `Date: x`, and the PMK-322 test `a definition over two lines with no later status` keeps `see ADR 3`, changed on purpose and said in the PR
- [x] A develop x branch comparison on random Status bodies shows refusal, text written and `adr-get` status equal, and only names differ, each difference explained, and `scripts/dev/adr-commonmark-diff.mjs` exits 0 with 0 worse on the full run, in the PR
