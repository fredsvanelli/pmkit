---
id: PMK-32
title: Add the user store for caches and personal defaults
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-5
milestone: linear
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

Source: Unified model, Q5 decision A ("The user store (e.g., `~/.config/pmkit/`) holds the discovery cache with a TTL and personal defaults. Tokens come from the OS keychain, env vars or existing CLI logins, never from the repo file").

## Acceptance criteria

- [ ] `~/.config/pmkit/` holds a discovery cache with a TTL and personal defaults
- [ ] No command writes a credential to a file in the repository
