---
id: PMK-179
title: Fix epic goal and the goal checks of validate
type: bug
status: in_progress
priority: high
estimate: 2
assignee: fred
related: [PMK-45]
branch: pmk-179-fix-epic-goal-and-the-goal-checks-of
created: 2026-10-31T16:01:13.865Z
updated: 2026-11-08T23:48:50Z
---

## Description

### Context

Goals on the Local tracker (PMK-45) merged with these defects, found by the review of PR #91. PMK-67 (initiatives-and-goals) uses these commands. Source: PMK-45, PR #91.

### Scope (in)

- `scripts/lib/local/tracker.mjs:1029`: `epic goal EPC-1 ""` removes the link with no warning. An empty `$GOAL` in a script writes the event `goal -> null`. `issues parent ISS ""` and `epic create --goal ""` refuse.
- `scripts/lib/validate.mjs:347`: an epic with `goal: notes` passes when `goals/notes.md` exists, and an epic whose goal file does not parse is not reported.
- `tracker.mjs:1035`: `epic goal` fails with `lists may hold scalars only` when the epic has an unknown key holding a list of maps, and it drops `# comment` lines and `""` keys of the frontmatter. It is the first command that rewrites `epic.md`.
- Open issues of a canceled epic still count in the goal progress, and the spec does not decide it.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [x] `epic goal <epic> ""` is refused, and only `none` clears the link
- [x] `validate` reports an epic whose goal is not a valid goal ID or whose goal file does not parse
- [x] `epic goal` keeps every frontmatter key and comment of `epic.md`
- [x] The spec decides how a canceled epic counts in goal progress, with a test
