---
id: PMK-155
title: Check the design spec CLI table against the usage strings
type: task
status: backlog
priority: low
parent: EPC-1
related: [PMK-117]
milestone: local-gaps
created: 2026-10-28T00:11:38.781Z
updated: 2026-10-28T00:11:38Z
---

## Description

Found in PMK-117. The `cycle add` row of the CLI table in `docs/superpowers/specs/2026-10-23-pmkit-design.md` shows `<sprint|none>`, while the usage says `<sprint|current|none>`. Fix the row and add a test that compares every row of the table with the CLI usage strings.
