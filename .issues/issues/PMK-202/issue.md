---
id: PMK-202
title: Fix the degraded and error paths of roadmap review
type: bug
status: backlog
priority: medium
estimate: 3
related: [PMK-66]
created: 2026-11-08T03:15:26.853Z
updated: 2026-11-08T03:15:26Z
---

## Description

### Context

Found by the reviews of PR #114 (PMK-66) and left as non-blocking. Source: PMK-66, PR #114.

### Scope (in)

- `scripts/lib/roadmap-review.mjs:108` and `:117`: a transient `UPSTREAM` error while listing epics or milestones prints "the tracker cannot list epics" and shows the late-issues fallback, as if the tracker had no epics.
- `scripts/lib/roadmap-review.mjs:77`: "started" does not follow the `epicRisks` window rule, so a todo epic started 3 days ago whose update read failed shows under `updatesNotChecked`.
- `scripts/lib/roadmap-review.mjs:122`: an unknown milestone delay prints blank, the same as on time.
- `scripts/lib/roadmap-review.mjs:14`: a Linear epic row shows only the last milestone, as a raw UUID.
- `scripts/pmkit.mjs:1845`: the per-epic reads keep going after `RATE_LIMITED`.
- A `capabilityNotes` throw in the `NOT_SUPPORTED` path fails the whole review instead of dropping the note.
- `risks` treats a failed update read as `[]` and reports `no_recent_update`. It should report "not checked", as `updatesNotChecked` does.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] A transient error listing epics or milestones marks that section incomplete and does not show the no-epics fallback
- [ ] An unknown delay reads as unknown in the text
- [ ] A Linear epic lists each of its milestones by name
- [ ] `risks` and `roadmap review` report a failed update read as not checked
