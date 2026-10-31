---
id: PMK-183
title: Fix team load without an active sprint and on Linear teams
type: bug
status: backlog
priority: medium
estimate: 2
related: [PMK-71]
created: 2026-10-31T16:01:19.821Z
updated: 2026-10-31T16:01:20Z
---

## Description

### Context

`pmkit team load` (PMK-71) merged with these defects, found by the second to fifth reviews of PR #92. Source: PMK-71, PR #92.

### Scope (in)

- `team load --sprint current` with no active sprint counts all open work, while `issues list --sprint current` returns nothing and warns. The spec says they behave the same.
- `commands/team/load.md` step 4 accepts any human member of the tracker as a target. On Linear it should be a member of the configured team.
- A member with `availability: 0` who still has work gets no flag, and the flag falls on someone else. Days off do not count when the command picks a target.
- With `estimation` `conditional` on Linear (t-shirt teams or mixed scales), the note gives the wrong reason.
- `scripts/lib/team-load.mjs:130`: the rule "the target does not end above the source" refuses moves that improve the spread (for example 10, with 6 in `todo`, against 0), and the text then says "without overloading someone", which is false. An estimate of 0 is reported as `unestimated`.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] `--sprint current` with no active sprint behaves as `issues list --sprint current` does
- [ ] On Linear, a reassignment target must be a member of the configured team
- [ ] A member with no availability and open work is flagged
- [ ] The no-move reason is right for a refused move that would not overload anyone, and for an estimate of 0
