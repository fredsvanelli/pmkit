---
id: PMK-7
title: Add the query index under .issues/.cache/
type: feature
status: in_progress
priority: medium
estimate: 5
assignee: fred
parent: EPC-1
milestone: local-gaps
branch: pmk-7-add-the-query-index-under-issues-cache
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T22:07:45Z
---

## Description

ADR-0001: the Local tracker has no index, so every search reads every issue file; the index is planned for phase 2.

Source: Local adapter, Collaboration ("Queries scan the files and build an index in `.issues/.cache/` (gitignored), rebuilt when file timestamps change"); MVP skills, local-doctor step 6.

## Acceptance criteria

- [ ] `issues list` reads the index and rebuilds the entries whose files changed
- [ ] Results are the same with and without the index
- [ ] `/pmkit:local:doctor` rebuilds the index
