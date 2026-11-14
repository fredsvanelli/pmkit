---
id: PMK-311
title: Keep a date or Supersedes line of the Status section in adr-status
type: feature
status: in_review
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
branch: pmk-311-keep-a-date-or-supersedes-line-of-the
created: 2026-11-14T01:43:01.712Z
updated: 2026-11-14T04:27:47Z
---

## Description

### Context

PMK-306 chose to refuse, not to keep, when the `## Status` section holds text besides the status, because `docs adr-get` reads the whole section as the status: a kept line would read as part of the new status. The cost, recorded in its spec and in `commands/spec/record-decision.md` step 7, is that common ADR formats can no longer be marked. Checked at 80918e6f:

- MADR, `Accepted` then `Date: 2024-01-02`: `adrStatusDropped` gives `["Date: 2024-01-02"]`, so `adr-status` refuses; `adr-get` reads the status as `Accepted Date: 2024-01-02`.
- Nygard, `Accepted`, a blank line, `Supersedes [ADR 3](0003-x.md)`: refused the same way; `adr-get` reads `Accepted Supersedes [ADR 3](0003-x.md)`.
- `/pmkit:spec:record-decision` runs `adr-status <old> superseded --by <new>` on the older ADRs (step 7). On these formats each one is refused and left unmarked, and the user has to move the line out of the Status section by hand and run `/pmkit:spec:adr-status` again.

This reverses the choice of PMK-306 for these lines, so it needs its own design: which line is the status, and what `adr-get` reads. Source: PMK-306, PR #267 (implementer and both review cycles).

### Scope (in)

- `docs adr-get` reads the status of a `## Status` section as the status line (or first paragraph) and stops including the rest of the section; the design says which, and how a section with one line reads as before.
- `docs adr-status` replaces only that status and keeps the other text of the section, real and dry run, so a MADR date line and a Nygard `Supersedes` line stay. The Supersedes line that `--by` writes does not duplicate one already there.
- The HTML block and code fence guards of PMK-299 and PMK-302 still refuse when the write would delete a heading.
- `commands/spec/record-decision.md`, `commands/spec/adr-status.md`, README and CHANGELOG follow.

### Out of scope

- The front matter `status:` key and the `Status:` line above the first section.
- Rewriting the other text of the section.

### Tasks

- [ ] Decide what the status of a multi-line Status section is, and record it in the spec (an ADR if it changes the reading contract)
- [ ] Read only the status in `adr-get` and keep the rest in `adr-status`
- [ ] Test MADR and Nygard ADRs through `adr-status` and `record-decision`

## Acceptance criteria

- [x] `adr-status` on a MADR ADR (`Accepted` and a date line) and on a Nygard ADR (`Accepted` and a `Supersedes` line) writes the new status and keeps the other line, real and dry run, with tests
- [x] `adr-get` on those ADRs reads the status alone (`Accepted`), and a Status section of one line reads as before, with tests
- [x] `adr-status ... superseded --by N` on an ADR that already has a `Supersedes` line keeps it and adds no duplicate, with a test
- [x] A write that would delete a heading taken in by an HTML block or a code fence is still refused, with the existing tests passing
