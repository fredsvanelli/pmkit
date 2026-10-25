---
id: PMK-69
title: Add the release-readiness command
type: feature
status: backlog
priority: medium
estimate: 3
parent: EPC-6
blocked_by: [PMK-22, PMK-49]
milestone: generic-commands
created: 2026-10-25T19:13:22Z
updated: 2026-10-25T19:13:26Z
---

## Description

Source: Unified model, PM catalog (`release-readiness`: "What's left for a release: open issues, PRs, deploys"; degradation "Milestone or cycle").

## Acceptance criteria

- [ ] Lists the open issues, open pull requests and deploys of a release
- [ ] Without releases it uses a milestone or a sprint, and says so
