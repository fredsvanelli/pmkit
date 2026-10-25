---
id: PMK-47
title: Keep a user inbox for the Local tracker
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-6
blocked_by: [PMK-32, PMK-2]
milestone: generic-commands
created: 2026-10-25T19:13:21Z
updated: 2026-10-25T19:13:25Z
---

## Description

Source: Local adapter, Capabilities (`user_inbox`: "Mentions (`@user`) and assignments since the user's last check, stored in the user store"); Unified model, `list_notifications`, `mark_read`.

## Acceptance criteria

- [ ] The CLI lists the mentions and assignments since the last check
- [ ] Marking read records the check in the user store
