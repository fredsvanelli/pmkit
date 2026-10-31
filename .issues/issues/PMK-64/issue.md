---
id: PMK-64
title: Add the todos-to-issues command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
related: [PMK-182]
milestone: generic-commands
branch: pmk-64-add-the-todos-to-issues-command
created: 2026-10-25T19:13:22Z
updated: 2026-10-31T16:01:18Z
---

## Description

Source: Unified model, Dev catalog (`todos-to-issues`: "TODO and FIXME become deduplicated issues"); Linear tab ("deduplicates against existing issues and proposes new ones"; "Creates after review").

## Acceptance criteria

- [x] Scans the repository for TODO and FIXME
- [x] Drops the ones that match an existing issue
- [x] Creates the rest after a full preview
