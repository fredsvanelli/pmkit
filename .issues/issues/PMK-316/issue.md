---
id: PMK-316
title: Name a non-status item and a repeated fence closer right in the adr-status refusal
type: bug
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-316-name-a-non-status-item-and-a-repeated
created: 2026-11-14T15:52:57.182Z
updated: 2026-11-14T17:40:30Z
---

## Description

### Context

When the `## Status` section has to be replaced whole (its status is not on a plain line at the top), `adr-status` refuses the write and names the status and the other text to move. Two cases still name the wrong lines. Checked at 46e15ecd with `docs adr-status 1 deprecated --dry-run`:

- A list item that does not read as a status, before the status: `- see ADR 3`, a blank line, `Accepted`. The refusal says it would delete the other text `"Accepted"`, the real status, and takes the note `- see ADR 3` as the status. Following it would move the status out of the section and keep the note. `statusLineOf` (`scripts/lib/adr.mjs`) takes the first item or quote as the status (PMK-313) without asking whether it reads as a known status, as `topLevelStatus` does since PMK-311.
- Two closed fences with the same closing line, after a status in a list item: `- Accepted`, blank, a fence holding `## X`, blank, `Date: 2024-01-02`, blank, the same fence again. The refusal names `"## X", "## X"` with the fence, then names `"```"` again as other text. The loop in `scripts/pmkit.mjs` that takes the closing lines of `adrFenceClosers` out of the other text removes them by text (`indexOf`), not by position, so a closer that shares its text with another line is matched once only.

Nothing is written or lost in either case: only the named lines are wrong. Source: PMK-313 (PR #281, review cycle 1).

### Scope (in)

- When the section starts with an item or quote that does not read as a known status and a later line does, the refusal names the later line as the status and the item as text to move.
- Each fence closing line is taken out of the other text by its position, so two fences with the same closer are both named once, with their fence.

### Out of scope

- What `adr-status` refuses and writes: every case refused today stays refused, every write that goes through today still goes through.
- What `adr-get` reads (a refused section is read whole, as today).

### Tasks

- [ ] Choose the named status in a refused section by the known status rule
- [ ] Match fence closing lines by position in the refusal

## Acceptance criteria

- [x] With `- see ADR 3`, a blank line and `Accepted`, the refusal names `Accepted` as the status and `- see ADR 3` as text to move, with a test, real and dry run
- [x] With two closed fences that share their closing line, each closing line is named once, with its fence, and none as other text, with a test
- [x] Every case refused before is still refused and nothing new is refused or written, with the existing tests unchanged in outcome and a develop x branch comparison on random Status sections in the PR
