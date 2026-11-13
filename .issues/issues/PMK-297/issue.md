---
id: PMK-297
title: Keep `<sha-1>/<x>` and other placeholders with a digit before `>` visible
type: bug
status: in_review
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-297-keep-sha-1-x-and-other-placeholders-with
created: 2026-11-12T22:25:13.901Z
updated: 2026-11-13T03:46:52Z
---

## Description

### Context

Since PMK-284, a digit before `>` is a redirect (`2>/dev/null`) unless a word character, `~` or `^` comes before it (`START`, `scripts/lib/paths.mjs:22`). After `-`, `.` or `<` it still counts, so `<sha-1>/<x> rest`, `<v1.2>/<x> rest` and `<1>/<2> rest` become `<sha-1><path>`, `<v1.2><path>` and `<1><path>`: the rest of the line is lost. Nothing leaks. Source: PMK-284, PR #239 (review cycle 3).

### Scope (in)

- A digit right after `-`, `.` or `<` is not a redirect.
- `2>/dev/null`, `>/dev/null` and `&>/x` stay hidden.

### Out of scope

- Other redirect forms.

### Tasks

- [ ] Narrow the redirect rule with tests first
- [ ] Run the PMK-284 battery against develop

## Acceptance criteria

- [x] `<sha-1>/<x>`, `<v1.2>/<x>` and `<1>/<2>` stay as they are, with tests
- [x] `2>/dev/null` and `>/dev/null` still hide the path, with a test
