---
id: PMK-18
title: "Compute lead time, throughput and aging in the CLI"
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-3
milestone: phase-2-commands
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

The CLI has `metrics velocity` and `metrics cycle-time`. ADR-0002: a command that needs a computation the CLI lacks waits for a CLI change.

Source: Local adapter, Capabilities (`native_metrics`: "Cycle time, lead time, throughput and aging from `events.jsonl`").

## Acceptance criteria

- [ ] The CLI computes lead time, throughput and aging from the event log
- [ ] Each metric takes a date range
