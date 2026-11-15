---
id: PMK-325
title: Name the status after link definitions a blank line closes in the adr-status refusal
type: bug
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-325-name-the-status-after-link-definitions-a
created: 2026-11-15T00:13:35.885Z
updated: 2026-11-15T03:38:13Z
---

## Description

### Context

Since PMK-322 the `adr-status` refusal names as the status the line the reader sees: it skips indented code, link reference definitions and lazy lines, and counts a line glued to the first shown paragraph, also after definitions glued to it. When the definitions are a block of their own, closed by a blank line, the glued line no longer counts, though the reader sees the same text. Only names are wrong; nothing refused, written or read changes. Checked with the CLI at a9ce211c, against commonmark.js 0.31.2:

- `Date: x`, `Accepted`, blank, `> Proposed` and `[a]: /u`, `Date: x`, `Accepted`, blank, `> Proposed` both keep `Accepted` (they delete `"Date: x", "> Proposed"` and `"[a]: /u", "Date: x", "> Proposed"`). `[a]: /u`, blank, `Date: x`, `Accepted`, blank, `> Proposed` keeps `> Proposed` and names `"[a]: /u", "Date: x", "Accepted"` as text to delete. commonmark.js renders the three the same: `<p>Date: x Accepted</p>`, then the quote.
- The same with two definitions (`[a]: /u`, `[b]: /v`, blank) and in a quote: `> [a]: /u`, `>`, `> Date: x`, `> Accepted`, blank, `> Proposed` keeps `> Proposed`, while `> Date: x`, `> Accepted`, blank, `> Proposed` keeps `> Accepted`.
- With no later status, the hidden definition is kept: `[a]: /u`, blank, `Date: x`, `Accepted` names `"Date: x", "Accepted"`, so it keeps `[a]: /u`, which the reader does not see. `Date: x`, `Accepted` keeps `Accepted`.

A definition closed by `---` is not this case: the `---` is a thematic break the reader sees, and `[a]: /u`, `---`, `Date: x`, `Accepted` names the same as `***` or `---` with no definition (the first shown block is not a paragraph, so the first line stays the fallback, as for indented code).

Source: PMK-322 (PR #297, review cycle 3, optional follow-up).

### Scope (in)

- One or more link reference definitions that open the section as a block of their own (closed by a blank line), at the top level and in a quote or list item, are skipped when finding the first shown paragraph, so its glued status counts as with no definition, and the hidden definition is never kept as the status.

### Out of scope

- A shown block before the paragraph: a thematic break (also a `---` after a definition) or indented code. The fallback to the first line stays.
- What is refused, written or read: only names change.

### Tasks

- [ ] Let the first shown paragraph start after the definitions that open the section as their own block, in `statusLineOf` (one walk, `paragraphOf`)
- [ ] Tests for the cases above, top level and in a quote, with and without a later status

## Acceptance criteria

- [ ] `[a]: /u` (or two definitions), blank, `Date: x`, `Accepted`, blank, `> Proposed`, and the same in a quote, refuse keeping `Accepted` (`> Accepted`) and naming every other line as text to delete, as with no definition, real and dry run, with tests
- [ ] `[a]: /u`, blank, `Date: x`, `Accepted` with no later status keeps `Accepted`, not the definition, with a test; `[a]: /u`, `---`, `Date: x`, `Accepted` and indented code first keep their names, with tests
- [ ] A develop x branch comparison on random Status bodies shows refusal, text written and `adr-get` status equal, and only names differ, each difference explained, in the PR
