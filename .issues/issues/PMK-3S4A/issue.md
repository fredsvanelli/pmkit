---
id: PMK-3S4A
title: Run digests on a schedule
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-ZZ72
blocked_by: [PMK-TQFP]
milestone: proactive
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Unified model, Q7 decision B ("`standup-digest`, `risk-radar` and `status-report` run on a schedule through the agent's scheduled tasks where available, or headless via the CLI in cron or a CI schedule"; "output needs a destination (Slack, email, a comment)").

Open: which destinations ship first.

## Acceptance criteria

- [ ] `/pmkit:team:standup`, risk-radar and `/pmkit:report:status` run headless from cron or a CI schedule
- [ ] The output goes to a destination the user configures
