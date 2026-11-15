---
id: PMK-328
title: "Read an ordered list item as a status in adr-status, as a bullet item"
type: bug
status: backlog
priority: medium
estimate: 2
assignee: fred
parent: EPC-6
created: 2026-11-15T23:21:50.971Z
updated: 2026-11-15T23:21:50Z
---

## Description

### Context

`readsAsStatus` in `scripts/lib/adr.mjs` skips punctuation and emphasis before the first word, but not the number of an ordered list item, so `1. Proposed` never reads as a status while `- Proposed` does. The write and the read change, not only names. Checked with the CLI at b3533a59, against commonmark.js 0.31.2:

- `Accepted`, blank, `1. Proposed` is written in place: the section becomes `Deprecated`, blank, `1. Proposed`, and `adr-get` reads `Accepted` before and `Deprecated` after, with no note. `Accepted`, blank, `- Proposed` refuses (`would delete the other text of the Status section, "- Proposed"`) and `adr-get` reads the section whole, `Accepted - Proposed`. commonmark.js renders `<ol><li>Proposed</li></ol>`, a second status the reader sees.
- `1. Accepted`, blank, `> Proposed` keeps `> Proposed` and names `"1. Accepted"` as text to delete, while `- Accepted`, blank, `> Proposed` keeps `- Accepted` and names `"> Proposed"`. The same with `1)`, `10.` and an indent of two spaces.
- Not this case: `see 1. Proposed` (its first word is `see`) and `1.Accepted` (no space after the marker, so a paragraph in CommonMark).

`scripts/dev/adr-write-compare.mjs` keeps a copy of the rule on purpose (its comment: a change to the rule in adr.mjs has to change this list too).

Source: PMK-325 (PR #302, review cycles 1 and 2: 1,458 of 150,000 random bodies).

### Scope (in)

- A line that opens an ordered list item (1 to 9 digits, then `.` or `)`, then a space or tab, as in CommonMark) reads as a status when its text does, as a bullet item does, everywhere `readsAsStatus` decides: the in-place guard, the section read whole, the refusal's names.
- The same rule in the copy in `scripts/dev/adr-write-compare.mjs`.

### Out of scope

- A number with no space after the marker (`1.Accepted`) and a number inside the text (`see 1. Proposed`): they stay as they are.

### Tasks

- [ ] Read an ordered list item as a status in `readsAsStatus`, and in its copy in `scripts/dev`
- [ ] Tests for the cases above, with bullet items as controls
- [ ] Run the develop x branch comparison and adr-commonmark-diff

## Acceptance criteria

- [ ] `Accepted`, blank, `1. Proposed` (also `1)`, `10.` and indented) refuses as `- Proposed` does, real and dry run, and `adr-get` reads the section as it reads the bullet one, with tests
- [ ] `1. Accepted`, blank, `> Proposed` keeps `1. Accepted` and names `> Proposed`, as the bullet item does, with tests; `1.Accepted` and `see 1. Proposed` keep their behaviour, with tests
- [ ] A develop x branch comparison on random Status bodies shows every difference in refusal, text written, `adr-get` status and names comes from an ordered list item that reads as a status, each explained, and `scripts/dev/adr-commonmark-diff.mjs` exits 0 with 0 worse on the full run, in the PR
