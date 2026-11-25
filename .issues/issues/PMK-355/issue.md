---
id: PMK-355
title: Cover the epic path of /pmkit:issues:move in the scenario tests
type: feature
status: done
parent: EPC-6
related: [PMK-353]
branch: pmk-355-cover-the-epic-path-of-pmkit-issues-move
created: 2026-11-21T07:03:24.081Z
updated: 2026-11-22T02:55:24Z
---

## Description

### Context

`commands/issues/move.md` gained an "Epic path" in PMK-353. The scenario harness (`scripts/scenario-helpers.mjs`) treats `## Epic path` as an `other` section, so its `epic move` dry run, its confirmation and its real run are outside the rules that check a write is dry-run and confirmed first. `scripts/__scenarios__/issues-move.mjs` excuses the epic path with `skip` and `notHit` entries. Today only the runbooks' CLI calls cover it.

### Scope (in)

- An epic scenario for `/pmkit:issues:move`, with the harness reading the epic path's calls and confirmation point

### Out of scope

- Other command files

## Acceptance criteria

- [x] A scenario runs the epic path of `/pmkit:issues:move` on a Local fixture epic and asserts the epic ends in the new status
- [x] The harness checks that the epic path's `epic move` dry run and its confirmation come before the real run
- [x] The `skip` and `notHit` entries for the epic path are removed from `scripts/__scenarios__/issues-move.mjs`
