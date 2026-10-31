---
id: PMK-52
title: Add issues delete
type: feature
status: done
priority: low
estimate: 2
assignee: fred
parent: EPC-6
related: [PMK-187, PMK-191]
milestone: generic-commands
branch: pmk-52-add-issues-delete
created: 2026-10-25T19:13:21Z
updated: 2026-10-31T16:59:11Z
---

## Description

Source: Unified model, contract family Issues (`delete`); Technical spec, write policy preview `delete`.

## Acceptance criteria

- [x] The CLI deletes an issue and refuses when other issues reference it
- [x] The command shows the full preview and asks before deleting
