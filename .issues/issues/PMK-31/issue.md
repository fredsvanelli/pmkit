---
id: PMK-31
title: Load hosted tracker configs
type: feature
status: backlog
priority: medium
estimate: 5
parent: EPC-5
milestone: linear
created: 2026-10-25T19:13:20Z
updated: 2026-10-25T19:13:20Z
---

## Description

The loader rejects any `tracker.system` other than `local` with `NOT_SUPPORTED`.

Source: Technical spec, Config schemas (`tracker.scope`, `mappings.status`, `mappings.fields`); Unified model, Q4 decision A.

## Acceptance criteria

- [ ] The loader accepts each `tracker.system` that has an adapter and validates `scope` and `mappings`
- [ ] A system without an adapter still fails with `NOT_SUPPORTED`
- [ ] Commands reach the adapter only through the contract
