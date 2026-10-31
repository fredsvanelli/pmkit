---
id: PMK-198
title: Pass issue titles through --title-file in every command file
type: bug
status: backlog
priority: high
estimate: 1
related: [PMK-73]
created: 2026-10-31T20:35:31.117Z
updated: 2026-10-31T20:35:31Z
---

## Description

### Context

Found by the third review of PR #109 (PMK-73), which added `issues create --title-file` so an advisory title never reaches the shell. Source: PMK-73, PR #109.

### Scope (in)

- `commands/issues/todos.md` and other command files still run `issues create --title "<title>"`. A title with a backtick or `$(` taken from code, a TODO or a user becomes command substitution in the agent's shell.
- No rule says how to write the title file. `echo "<title>" > file` brings the title back to the shell, and descriptions have the same risk.
- `scripts/lib/alerts.mjs:158` (`alertCandidate`) does not join line breaks in an advisory title, so such an advisory fails on every run.

### Out of scope

- The improvements listed in `docs/superpowers/epc-6-follow-ups.md`.

## Acceptance criteria

- [ ] No command file puts a title or a description taken from data into a shell argument
- [ ] `conventions.md` says to write title and description files with the file tool, never with `echo`
- [ ] An advisory title with a line break is joined into one line
