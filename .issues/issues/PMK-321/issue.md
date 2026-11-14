---
id: PMK-321
title: "Check the new line and the lines outside the section in the adr-commonmark-diff write check, and exercise container fences"
type: chore
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-321-check-the-new-line-and-the-lines-outside
created: 2026-11-14T19:16:52.893Z
updated: 2026-11-14T20:19:35Z
---

## Description

### Context

`scripts/dev/adr-commonmark-diff.mjs` checks each write by its shape (PMK-318, `writeShape` and `compareWrites` in `scripts/dev/adr-write-compare.mjs`). Three gaps remain, checked at 96bc3e5c by calling the helper and from the PMK-317 review:

- The new line of an in-place write is not checked. A head that writes an empty line, or `foo`, in place of `Accepted` counts as `acceptedWhereRefused`, and so does one that drops the hard line break PMK-314 keeps (`Accepted  ` written as `Superseded by x`).
- A whole-section write compares the rest of the document by trimmed lines. A head that strips the indent of a line after the section (`    indented` written as `indented`, indented code turned into a paragraph) counts as `same`.
- The corpus never exercises the in-place write past a fence in a quote or list item (PMK-317): the full run reports 0 written where the base refused for those bodies, so it says nothing about that guard.

Source: PMK-318 (PR #286, review cycles 1 and 2) and PMK-317 (PR #288, review cycle 1).

### Scope (in)

- An in-place write puts the status the command asked for on the replaced line, with the indent and the hard line break of the old line kept; anything else is worse.
- A whole-section write keeps every line outside the section byte for byte.
- Corpus cases: a status on a plain line, then a fence (and an HTML block) in a quote and in a list item holding a heading-like line, ended by a later line, a blank line, an ATX or setext heading, or the end of the file.

### Out of scope

- `scripts/lib/adr.mjs` and the rules it applies.
- Running the script in `npm test`.

### Tasks

- [ ] Check the new line of an in-place write
- [ ] Compare the lines outside the section byte for byte on a whole-section write
- [ ] Add the container fence cases to the corpus

## Acceptance criteria

- [x] `compareWrites` reports worse for an in-place write whose new line is not the requested status with the old line's indent and hard line break, and for a whole-section write that changes a line outside the section, with tests in `scripts/dev/adr-write-compare.test.mjs`
- [x] The corpus has the container fence and HTML cases, and a full run from 3f24c7e6 to the current develop reports 0 worse, exits 0 and counts writes where the base refused for them, with the run in the PR
- [x] A mutation in a temporary copy that drops the hard line break on the in-place write, and one that strips the indent of a line after the section on a whole-section write, each make the script exit 1, shown in the PR
