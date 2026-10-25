---
id: PMK-1HGD
title: Turn local scanner output into security alerts
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-A6FH
blocked_by: [PMK-YJQN]
milestone: generic-commands
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:26Z
---

## Description

Source: Local adapter, Capabilities (`security_alerts`: "Output of local scanners the repo already has (e.g., `npm audit`), turned into issues"); Unified model, `list_alerts`.

## Acceptance criteria

- [ ] `list_alerts` reads the output of the scanners the repository has
- [ ] An alert maps to a severity
