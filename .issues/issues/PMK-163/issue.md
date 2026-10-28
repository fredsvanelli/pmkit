---
id: PMK-163
title: "Check paragraph indentation after list items in commands, skills and docs"
type: chore
status: backlog
priority: low
parent: EPC-1
related: [PMK-124]
milestone: local-gaps
created: 2026-10-28T00:11:40.560Z
updated: 2026-10-28T00:11:40Z
---

## Description

Found in PMK-124. Add a static rule in `scripts/scenarios.test.mjs` that fails on an indented paragraph right after a list item with no blank line between them, over `commands/`, `skills/` and `docs/`.
