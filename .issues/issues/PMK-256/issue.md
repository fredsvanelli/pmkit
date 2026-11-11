---
id: PMK-256
title: "Fix unarchive edge cases in history, views and bulk limits"
type: bug
status: in_progress
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-256-fix-unarchive-edge-cases-in-history
created: 2026-11-11T22:34:42.444Z
updated: 2026-11-11T22:57:31Z
---

## Description

### Context

PMK-250 added `issues unarchive` and `issues bulk unarchive` on the Local tracker. The second review approved it with four edge cases left over. Source: PMK-250, PR #205.

### Scope (in)

- A git merge that duplicates a whole archive, unarchive, archive, unarchive sequence leaves doubled events in the issue history (`scripts/lib/local/events.mjs:54`). The final state is right.
- With `--view` and a view without `archived`, the refusal says "Add --archived to the filter", which cannot work with `--view` (`scripts/lib/bulk.mjs:99`); it should point to saving the view with `--archived`.
- On Linear, `issues bulk unarchive --view` gets the hosted-view error before the `NOT_SUPPORTED` refusal (`scripts/pmkit.mjs:2735`), and the refusal text is duplicated in `linear/tracker.mjs`.
- `hasMore` and `--max` count the issues before the in-memory archived filter (`scripts/pmkit.mjs:2740`), so a bulk unarchive can be refused for too many live issues.

### Out of scope

- A bulk unarchive with no narrowing filter.

### Tasks

- [ ] Show each event once after a merge that repeats a sequence
- [ ] Point a view without archived to the right fix
- [ ] Refuse bulk unarchive on Linear first
- [ ] Count only archived issues against the bulk limits

## Acceptance criteria

- [x] After a merge that repeats an archive and unarchive sequence, the issue history shows each event once
- [x] A bulk unarchive with a view that lacks archived says to save the view with `--archived`
- [x] On Linear, `issues bulk unarchive` always answers `NOT_SUPPORTED` first, whatever other flags it has
- [x] A bulk unarchive is never refused because of the number of live issues the filter also matches
