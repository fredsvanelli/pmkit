---
id: PMK-267
title: Fix unarchive history repeats within one second and the Linear flag check
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-267-fix-unarchive-history-repeats-within-one
created: 2026-11-12T00:00:31.358Z
updated: 2026-11-12T00:07:13Z
---

## Description

### Context

PMK-256 fixed four edge cases of `issues unarchive` and `issues bulk unarchive`. Its implementer and its review left two cases over. Source: PMK-256, PR #214.

### Scope (in)

- A git merge that duplicates an archive and unarchive sequence made within one second still leaves part of the duplicate events in the issue history (`scripts/lib/local/events.mjs:56`). A flip back within the second of the last kept event counts as new, so a merge copy of that flip is kept too. The final state is right.
- On Linear, `issues bulk unarchive` with a flag the command does not take (for example `--limit`) gets the generic unknown-flag error before the `NOT_SUPPORTED` refusal (`scripts/pmkit.mjs:2758`).

### Out of scope

- Unarchive on Linear.

### Tasks

- [ ] Show each event once after a merge of a sequence made within one second
- [ ] Refuse bulk unarchive on Linear before the flag check

## Acceptance criteria

- [x] After a merge that repeats an archive, unarchive, archive, unarchive sequence made within one second, the issue history shows each event once
- [x] On Linear, `issues bulk unarchive` with any flag answers `NOT_SUPPORTED`
