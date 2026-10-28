---
id: PMK-154
title: Say when a current reader finds no active sprint
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-116]
milestone: local-gaps
created: 2026-10-28T00:11:38.633Z
updated: 2026-10-28T00:11:38Z
---

## Description

Found in PMK-116. `issues list --sprint current` now warns on stderr when no sprint is active. `commands/issues/find.md` has no clause for that warning, and `skills/pmkit/references/conventions.md` has no rule for reading warnings. Other readers of `current` may still fail silently, and `--json` output has no warnings array.
