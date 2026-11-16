---
id: PMK-294
title: Warn when the Status section is empty and a setext heading follows
type: bug
status: done
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-294-warn-when-the-status-section-is-empty
created: 2026-11-12T14:41:35.455Z
updated: 2026-11-12T20:41:51Z
---

## Description

### Context

PMK-283 fixed by test what `adr-status` writes for `## Status\nAccepted\n---`: `Accepted` underlined is a heading (CommonMark, PMK-273), so the section is empty, `adr-get` reads null, and `adr-status` writes `## Status\n\nDeprecated\n\nAccepted\n---`. A reader then sees two statuses. The orchestrator chose the characterization test and left this follow-up (comment on PMK-283). Only `---` is tested, not `===`. Source: PMK-283, PR #236.

### Scope (in)

- `adr-get` and `adr-status` add a note when the Status section is empty and the next line is a setext heading, naming that line.
- The characterization test also covers `===`.

### Out of scope

- Changing what is read or written.

### Tasks

- [ ] Add the note
- [ ] Test it with `---` and `===`

## Acceptance criteria

- [x] `adr-get` and `adr-status` on `## Status\nAccepted\n---` and `===` say that `Accepted` reads as a heading, with a test
- [x] What `adr-status` writes is unchanged, with a test
