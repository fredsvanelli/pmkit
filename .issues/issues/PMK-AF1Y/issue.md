---
id: PMK-AF1Y
title: Add an optional GitHub Action that moves merged issues to done
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-ZZ72
milestone: proactive
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

Source: MVP skills, MQ2 decision ("A in the MVP, B as an optional add-on in phase 2": "A workflow on `pull_request: closed` updates `.issues/` on the default branch").

## Acceptance criteria

- [ ] A workflow on `pull_request: closed` moves the issue of a merged branch from in_review to done
- [ ] It makes one commit per merge on the default branch
- [ ] Setup installs it only when the user asks
