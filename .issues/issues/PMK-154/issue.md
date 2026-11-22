---
id: PMK-154
title: Say when a current reader finds no active sprint
type: task
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-116]
milestone: local-gaps
branch: pmk-154-say-when-a-current-reader-finds-no
created: 2026-10-28T00:11:38.633Z
updated: 2026-11-22T04:05:22Z
---

## Description

Found in PMK-116. `issues list --sprint current` now warns on stderr when no sprint is active. `commands/issues/find.md` has no clause for that warning, and `skills/pmkit/references/conventions.md` has no rule for reading warnings. Other readers of `current` may still fail silently, and `--json` output has no warnings array.

## Acceptance criteria

- [x] `issues list --json` and `views run --json` hold the warnings the CLI prints, the no-active-sprint one included
- [x] `issues bulk` with `--sprint current` and no active sprint warns, on stderr and in its JSON, instead of saying nothing would change
- [x] `skills/pmkit/references/conventions.md` has a rule for reading warnings, and `commands/issues/find.md` and `commands/issues/bulk.md` say what to do with the no-active-sprint warning
