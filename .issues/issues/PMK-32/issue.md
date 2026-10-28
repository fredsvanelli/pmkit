---
id: PMK-32
title: Add the user store for caches and personal defaults
type: feature
status: done
priority: medium
estimate: 3
assignee: fred
parent: EPC-5
milestone: linear
branch: pmk-32-add-the-user-store-for-caches-and
created: 2026-10-25T19:13:20Z
updated: 2026-10-28T00:13:43Z
---

## Description

Source: Unified model, Q5 decision A ("The user store (e.g., `~/.config/pmkit/`) holds the discovery cache with a TTL and personal defaults. Tokens come from the OS keychain, env vars or existing CLI logins, never from the repo file").

## Acceptance criteria

- [x] `~/.config/pmkit/` holds a discovery cache with a TTL and personal defaults
- [x] No command writes a credential to a file in the repository
