---
id: PMK-354
title: Test that every remote tracker routes the operations its adapters implement
type: feature
status: in_progress
parent: EPC-6
related: [PMK-353]
branch: pmk-354-test-that-every-remote-tracker-routes
created: 2026-11-21T07:03:23.598Z
updated: 2026-11-22T02:12:35Z
---

## Description

### Context

The Linear and GitHub trackers build their contract from a `contract` map in `scripts/lib/linear/tracker.mjs` and `scripts/lib/github/tracker.mjs`, then fill every missing operation with `implemented[operation] ?? stub(operation)`. An operation that an adapter's `*-ops.mjs` implements but the map does not route answers NOT_SUPPORTED with no error. PMK-353 hit this: `moveDeliverable` existed in both `project-ops.mjs` files but answered NOT_SUPPORTED until a contract case called it.

### Scope (in)

- A test that, for each remote tracker, checks every contract operation its ops modules return is routed by `tracker.mjs`

### Out of scope

- Changing how unimplemented operations are stubbed

## Acceptance criteria

- [ ] A test fails when an operation returned by a Linear or GitHub `*-ops.mjs` module is missing from that tracker's `contract` map
- [ ] The test passes on the current code
- [ ] Removing `moveDeliverable` from `scripts/lib/github/tracker.mjs` makes the test fail and name the operation
