---
id: PMK-48
title: Turn local scanner output into security alerts
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
blocked_by: [PMK-2]
related: [PMK-175]
milestone: generic-commands
branch: pmk-48-turn-local-scanner-output-into-security
created: 2026-10-25T19:13:21Z
updated: 2026-10-31T03:04:29Z
---

## Description

Source: Local adapter, Capabilities (`security_alerts`: "Output of local scanners the repo already has (e.g., `npm audit`), turned into issues"); Unified model, `list_alerts`.

## Acceptance criteria

- [x] `list_alerts` reads the output of the scanners the repository has
- [x] An alert maps to a severity
