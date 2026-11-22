---
id: PMK-163
title: "Check paragraph indentation after list items in commands, skills and docs"
type: chore
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-124]
milestone: local-gaps
branch: pmk-163-check-paragraph-indentation-after-list
created: 2026-10-28T00:11:40.560Z
updated: 2026-11-22T04:06:20Z
---

## Description

Found in PMK-124. Add a static rule in `scripts/scenarios.test.mjs` that fails on an indented paragraph right after a list item with no blank line between them, over `commands/`, `skills/` and `docs/`.

## Acceptance criteria

- [ ] `scripts/scenarios.test.mjs` fails, naming the file and line, on an indented paragraph right after a list item with no blank line, over `commands/`, `skills/` and `docs/`
- [ ] The places it finds today are fixed
