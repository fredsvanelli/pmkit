---
id: PMK-300
title: Say that the old setext heading stays below the status adr-status writes
type: bug
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-300-say-that-the-old-setext-heading-stays
created: 2026-11-12T22:25:14.248Z
updated: 2026-11-13T00:20:16Z
---

## Description

### Context

When `## Status` is followed by `Accepted\n---`, the section is empty and `Accepted` reads as a heading (PMK-273). `adr-get` and `adr-status` add a note (PMK-294, `statusHeadingNote`, `scripts/pmkit.mjs:379`). With a `Status:` line or a `status:` key, the note says the heading "is not a second status". But `adr-status deprecated` writes `Status: deprecated\n\n## Status\n\nDeprecated\n\nAccepted\n---`: the old heading stays under the new status, and a reader sees two. Without another form the same happens; the note describes the text before the write. Source: PMK-294, PR #249 (review cycle 3).

### Scope (in)

- After a write, the `adr-status` note says the heading stays below the new status and names it, so the user can remove it.

### Out of scope

- Removing the heading: it may not be a status.

### Tasks

- [ ] Change the adr-status note for a written status
- [ ] Test with and without a Status: line

## Acceptance criteria

- [x] `adr-status` on `## Status\nAccepted\n---` says the heading Accepted stays below the new status, with and without a `Status:` line, with tests
- [x] `adr-get` keeps its note, with a test
