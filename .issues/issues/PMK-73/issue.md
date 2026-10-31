---
id: PMK-73
title: Add the security-alerts command
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-6
blocked_by: [PMK-48]
related: [PMK-198]
milestone: generic-commands
branch: pmk-73-add-the-security-alerts-command
created: 2026-10-25T19:13:22Z
updated: 2026-10-31T20:35:31Z
---

## Description

Source: Unified model, EM catalog (`security-alerts`: "Security alerts become prioritized issues"; degradation "Unavailable").

## Acceptance criteria

- [x] Turns security alerts into issues with a priority from the severity, after a full preview
- [x] Without security alerts it says the capability is absent
