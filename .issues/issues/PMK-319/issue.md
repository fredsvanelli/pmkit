---
id: PMK-319
title: "Name a status in a quote or item after a plain first line, and each fence once, in the adr-status refusal"
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-319-name-a-status-in-a-quote-or-item-after-a
created: 2026-11-14T19:16:52.687Z
updated: 2026-11-14T19:35:48Z
---

## Description

### Context

When the `## Status` section has to be replaced whole, `adr-status` refuses the write and names the status and the other text to move (PMK-313, PMK-316). Two cases still name the wrong lines. Checked at 96bc3e5c with `docs adr-status 1 deprecated --dry-run`:

- A first line that is plain text but not a known status, then the status in a quote or list item: `Date: 2024-01-02`, a blank line, `> Accepted` (or `- Accepted`). The refusal says it would delete the other text `"> Accepted"`, the real status, so `Date: 2024-01-02` is taken as the status. Following the next step would move the status out of the section and keep the date. PMK-316 prefers a later line that reads as a known status only when the first line is an item or quote (`statusLineOf` in `scripts/lib/adr.mjs`); a first plain line takes the old path.
- Two closed fences with the same opening line, after a status in a list item: `- Accepted`, blank, a fence holding `## X`, blank, `Date: 2024-01-02`, blank, the same fence holding `## Y`. The refusal says `"## X", "## Y", which the code fence "```" takes`, one fence, while two different fences are named as `the code fences "```", "~~~" take`.

Nothing is written or lost in either case: only the named lines are wrong. Source: PMK-316 (PR #287, review cycles 1 to 3).

### Scope (in)

- When the first line of a refused section is plain text that does not read as a known status and a later top-level item or quote does, the refusal names that later line as the status and the first line as text to move, with the rule PMK-316 uses for an item or quote.
- Each fence the refusal names is counted as one fence, so two fences with the same opener read as two (`the code fences "```", "```" take`, or a count).

### Out of scope

- What `adr-status` refuses and writes, and what `adr-get` reads.
- The fence guard of the in-place write (PMK-320).

### Tasks

- [ ] Choose the named status by the known status rule when the first line is plain text
- [ ] Name each fence once, also when two share their opener

## Acceptance criteria

- [x] With `Date: 2024-01-02`, a blank line and `> Accepted`, and the same with `- Accepted`, the refusal names the quote or item as the status and `Date: 2024-01-02` as text to move, with a test, real and dry run
- [x] With two closed fences that share their opener, the refusal names two fences, with a test
- [x] Every case refused before is still refused and nothing new is refused or written, with the existing tests unchanged in outcome and a develop x branch comparison on random Status sections in the PR that checks every line `adrStatusDropped` returns is named once in the refusal
