---
id: PMK-44
title: Add saved views to the Local tracker
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-6
blocked_by: [PMK-2]
milestone: generic-commands
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Local adapter, Entity mapping ("`views/<name>.yaml` with a query"); MVP skills, query ("offers to save as a view when the same query repeats"); Unified model, `run_saved_view`.

## Acceptance criteria

- [ ] `views/<name>.yaml` stores an issue filter
- [ ] The CLI saves, lists and runs a view
- [ ] `/pmkit:issues:find` offers to save a repeated query as a view
- [ ] `capabilities` reports `saved_views` as native
