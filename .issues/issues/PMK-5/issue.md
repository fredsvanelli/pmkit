---
id: PMK-5
title: Let setup add labels to the Local tracker
type: feature
status: backlog
priority: medium
estimate: 2
parent: EPC-1
milestone: local-gaps
created: 2026-10-25T19:13:19Z
updated: 2026-10-25T19:13:19Z
---

## Description

Found while importing the requirements with `/pmkit:spec:import`: `init` has no flag for labels, so the `needs-criteria` label that spec:import uses cannot be configured without editing `.issues/config.yaml` by hand.

## Acceptance criteria

- [ ] `init --update` adds labels from a flag and keeps the existing labels and comments
- [ ] `/pmkit:setup` offers the `needs-criteria` label
