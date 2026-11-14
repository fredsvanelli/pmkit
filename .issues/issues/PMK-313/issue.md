---
id: PMK-313
title: "Name the extra text, not the status, in the adr-status refusal of a list item or quote"
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-313-name-the-extra-text-not-the-status-in
created: 2026-11-14T05:29:38.033Z
updated: 2026-11-14T05:50:43Z
---

## Description

### Context

When the status of a `## Status` section is in a list item or a quote, `adr-status` refuses the write as before PMK-311 (one `INVALID_INPUT`, nothing written), but the refusal names the wrong lines. `statusLineOf` (`scripts/lib/adr.mjs`) takes the first line that does not open a block as the status, so a list item or a quote is skipped and a later plain line is taken as the status. Checked at 5d09c170 with `docs adr-status 1 deprecated --dry-run`:

- `- Accepted`, a blank line, `Date: 2024-01-02`: the refusal says it would delete the other text `"- Accepted"`, the status, and does not name the date. The same with `* Accepted` and a `Supersedes [ADR 3](0003-x.md)` line, and with `> Accepted` and a date line.
- `- - Accepted` then `bar` (a nested item with a lazy line): the refusal names `"- - Accepted"`.
- A closed code fence that holds a heading-like line, in a section whose status is a list item (`- Accepted`, blank, ```` ``` ````, `## X`, ```` ``` ````): the refusal names `## X` with the fence, and its closing line ```` ``` ```` again as other text. The same in a quote (`> ```` `).

Following the refusal would move the status out of the section and keep the extra line. `topLevelStatus` and `statusLineOf` choose lines with regexes, while the block walk of `sectionEnd` already knows which lines are list items, quotes and fence lines; reusing it is one way to get both right. Source: PMK-310 (PR #275, review cycles 1 to 3) and PMK-311 (PR #278, review cycles 2 and 3).

### Scope (in)

- The refusal names the status a reader sees (the first item or quote line when the section starts with one) as the status, and names the other lines as the text to move.
- The closing line of a fence is named with its fence, not as other text, as PMK-310 did for the opening line.

### Out of scope

- What `adr-status` refuses and writes: every case refused today stays refused, every write that goes through today still goes through.
- Writing a status in a list item or a quote in place (PMK-311 refuses those as develop did).

### Tasks

- [ ] Choose the status line from the block structure, so a list item or a quote at the top is the status
- [ ] Name the closing line of a fence with its fence

## Acceptance criteria

- [x] With the status in a list item or a quote followed by a blank line and a date or Supersedes line, and with a nested item followed by a lazy line, the refusal names the extra line, not the status, with tests
- [x] The closing line of a fence held in the Status section is named once, with its fence, with a test in a list and in a quote
- [x] Every case refused before is still refused and nothing new is refused, with the existing tests unchanged in outcome
