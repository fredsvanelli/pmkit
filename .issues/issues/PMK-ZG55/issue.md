---
id: PMK-ZG55
title: Add the Linear API client
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-NCQN
blocked_by: [PMK-N3WC]
milestone: linear
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:24Z
---

## Description

Source: Unified model, Q1 decision D; Technical spec, Errors (`AUTH`, `RATE_LIMITED`, `UPSTREAM`).

## Acceptance criteria

- [ ] Calls the Linear GraphQL API with the credential chosen in the auth decision
- [ ] Pages through results
- [ ] Maps failures to `AUTH`, `RATE_LIMITED` and `UPSTREAM` with a next step
- [ ] `package.json` gains no dependency
