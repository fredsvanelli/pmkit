---
id: PMK-30
title: Add the Linear API client
type: feature
status: in_review
priority: medium
estimate: 5
assignee: fred
parent: EPC-5
blocked_by: [PMK-28]
milestone: linear
branch: pmk-30-add-the-linear-api-client
created: 2026-10-25T19:13:20Z
updated: 2026-10-28T00:53:27Z
---

## Description

Source: Unified model, Q1 decision D; Technical spec, Errors (`AUTH`, `RATE_LIMITED`, `UPSTREAM`).

## Acceptance criteria

- [x] Calls the Linear GraphQL API with the credential chosen in the auth decision
- [x] Pages through results
- [x] Maps failures to `AUTH`, `RATE_LIMITED` and `UPSTREAM` with a next step
- [x] `package.json` gains no dependency
