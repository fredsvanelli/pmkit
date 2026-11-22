---
id: PMK-155
title: Check the design spec CLI table against the usage strings
type: task
status: in_progress
priority: low
assignee: fred
parent: EPC-1
related: [PMK-117]
milestone: local-gaps
branch: pmk-155-check-the-design-spec-cli-table-against
created: 2026-10-28T00:11:38.781Z
updated: 2026-11-22T03:16:05Z
---

## Description

Found in PMK-117. The `cycle add` row of the CLI table in `docs/superpowers/specs/2026-10-23-pmkit-design.md` shows `<sprint|none>`, while the usage says `<sprint|current|none>`. Fix the row and add a test that compares every row of the table with the CLI usage strings.

## Acceptance criteria

- [x] The `cycle add` row of the design spec CLI table shows `<sprint|current|none>`, and the other rows that drift from the usage are fixed
- [x] A test fails when a row names a command, a flag or a set of values that differs from the CLI usage strings
