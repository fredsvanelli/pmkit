---
id: PMK-2
title: The capability manifest reports capabilities that no command serves
type: bug
status: backlog
priority: high
estimate: 2
parent: EPC-1
milestone: local-gaps
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T19:13:19Z
---

## Description

`buildCapabilities` in `scripts/lib/capabilities.mjs` marks `strategic_goals`, `releases`, `saved_views`, `demand_signals` and `request_queue` native, and `security_alerts` and `user_inbox` derived. No CLI command reads or writes goals, releases, views, customers or requests, scans for alerts or keeps an inbox, so `/pmkit:help` and every command that reads the manifest promise paths that do not exist. ADR-0001 says the Local tracker serves all 20 capabilities.

Source: Local adapter, Capabilities; Unified model, How a skill picks its path.

## Acceptance criteria

- [ ] Every capability marked native or derived is served by at least one CLI command
- [ ] A capability without a command is reported `absent` with an `enableHint`
- [ ] A test fails when a capability is native or derived and no CLI command serves it
- [ ] ADR-0001 lists the capabilities served today
