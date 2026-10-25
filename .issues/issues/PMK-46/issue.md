---
id: PMK-46
title: Add customers and requests to the Local tracker
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-6
blocked_by: [PMK-2]
milestone: generic-commands
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Local adapter, Entity mapping ("`customers/*.md` and `requests/*.md`, linked to issues") and Capabilities (`request_queue`: "`requests/` as an inbox, triaged into issues"); Unified model, `list_demand_signals`, `list_requests`.

## Acceptance criteria

- [ ] `customers/` and `requests/` hold records linked to issues
- [ ] The CLI lists demand signals and requests
- [ ] `capabilities` reports `demand_signals` and `request_queue` as native
