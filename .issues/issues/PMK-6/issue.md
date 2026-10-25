---
id: PMK-6
title: Commit each operation when auto_commit is on
type: feature
status: in_progress
priority: medium
estimate: 3
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-6-commit-each-operation-when-auto-commit
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T21:50:47Z
---

## Description

`auto_commit: false` is in the config template, but nothing reads it.

Source: Local adapter, Collaboration item 4 and decision L5 (B as an option).

## Acceptance criteria

- [ ] With `auto_commit: true`, each write makes one commit with only the tracker files it changed
- [ ] With `auto_commit: false`, the default, no command commits
- [ ] A `--dry-run` never commits
