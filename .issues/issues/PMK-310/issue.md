---
id: PMK-310
title: Name the right lines in the adr-status refusal
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-310-name-the-right-lines-in-the-adr-status
created: 2026-11-14T01:43:01.589Z
updated: 2026-11-14T02:53:35Z
---

## Description

### Context

PMK-306 made `adr-status` refuse, with one `INVALID_INPUT`, to delete text of the `## Status` section besides the status, naming every cause: an HTML block or a code fence that takes a heading into the section, and the other text (`adrStatusDropped`, `scripts/lib/adr.mjs:440-446`, gathered in `scripts/pmkit.mjs:490-503`). The refusal is right, and nothing is written, but some of the lines it names are wrong. Checked at 80918e6f:

- The line that opens the HTML block or the fence is named twice: once as the opener of the block and once as other text. `## Status\n\n<!-- note\nAccepted\n\n## Context\n\nWhy.` gives `adrStatusDropped` `["<!-- note", "## Context", "Why."]` and `adrHtmlHeld` `["## Context", "Why."]`; the dedup in `pmkit.mjs:495-498` removes only the lines the guard names, so `<!-- note` stays in the other text and the next step gets a third clause. The same with a fence: `["```", "## Context", "Why."]`.
- `statusLineOf` (`adr.mjs:432-433`) takes the first line that does not open a block as the status. With the status in a code span (`` `Accepted` `` then `Date: 2020`) it picks `Date: 2020` and the refusal names `` `Accepted` `` as the text to move out; with a list item and a lazy line (`- Accepted` then `lazy`) it names `- Accepted`. Following the next step would move the status out and keep the extra line.
- The spec and the plan of PMK-306 call the function `adrStatusOther`; the code has `adrStatusDropped`.

Source: PMK-306, PR #267 (review cycle 2).

### Scope (in)

- The refusal names each line once, under the cause that takes it: the opener of an HTML block or a fence goes with that block, not with the other text.
- The line named as the status is the one a reader takes as the status, in a code span and in a list item with a lazy line too; the other text named is what the user has to move.
- The spec and the plan of PMK-306 use the name in the code.

### Out of scope

- What `adr-status` refuses: every case refused today stays refused, every write that goes through today still goes through.
- Keeping the other text instead of refusing.

### Tasks

- [ ] Name the opener of an HTML block or a fence only with its block
- [ ] Pick the status line in a code span and in a list item with a lazy line
- [ ] Align the PMK-306 spec and plan with `adrStatusDropped`

## Acceptance criteria

- [x] An HTML block or a fence that takes a heading into the Status section is named once in the refusal, with its opener, and its opener is not repeated as other text, with tests for both
- [x] With the status in a code span followed by a line, or in a list item followed by a lazy line, the refusal names the extra line, not the status, with a test
- [x] Every case refused before is still refused and nothing new is refused, with the existing tests unchanged in outcome
