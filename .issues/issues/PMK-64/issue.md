---
id: PMK-64
title: Add the todos-to-issues command
type: feature
status: in_progress
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
milestone: generic-commands
branch: pmk-64-add-the-todos-to-issues-command
created: 2026-10-25T19:13:22Z
updated: 2026-10-30T23:12:52Z
---

## Description

Source: Unified model, Dev catalog (`todos-to-issues`: "TODO and FIXME become deduplicated issues"); Linear tab ("deduplicates against existing issues and proposes new ones"; "Creates after review").

## Acceptance criteria

- [ ] Scans the repository for TODO and FIXME
- [ ] Drops the ones that match an existing issue
- [ ] Creates the rest after a full preview
