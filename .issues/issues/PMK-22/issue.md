---
id: PMK-22
title: Add releases to the Local tracker
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-3
blocked_by: [PMK-2]
milestone: phase-2-commands
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Local adapter, Entity mapping ("`releases/<version>.md`, optionally tied to a git tag"); Unified model, contract family Releases (`list_releases`, `release_issues`, `mark_released`).

## Acceptance criteria

- [ ] `releases/<version>.md` holds a release, optionally tied to a git tag
- [ ] The CLI lists releases, lists the issues of a release and marks a release released
- [ ] `capabilities` reports `releases` as native
