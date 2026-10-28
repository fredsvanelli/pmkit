---
id: PMK-31
title: Load hosted tracker configs
type: feature
status: in_review
priority: medium
estimate: 5
assignee: fred
parent: EPC-5
milestone: linear
branch: pmk-31-load-hosted-tracker-configs
created: 2026-10-25T19:13:20Z
updated: 2026-10-28T00:01:59Z
---

## Description

The loader rejects any `tracker.system` other than `local` with `NOT_SUPPORTED`.

Source: Technical spec, Config schemas (`tracker.scope`, `mappings.status`, `mappings.fields`); Unified model, Q4 decision A.

## Acceptance criteria

- [x] The loader accepts each `tracker.system` that has an adapter and validates `scope` and `mappings`
- [x] A system without an adapter still fails with `NOT_SUPPORTED`
- [x] Commands reach the adapter only through the contract
