---
id: PMK-301
title: Pass the test suite under Node 26
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-301-pass-the-test-suite-under-node-26
created: 2026-11-12T22:25:14.338Z
updated: 2026-11-12T22:39:48Z
---

## Description

### Context

With Node 26.4.0 (Homebrew), `npm test` on develop 7f26b46 has 3 failures (5037 tests, 4943 pass); with Node 22.22.0 it passes. Two causes:

- The child test runs read TAP, but Node 26's default reporter is spec when the output is not a terminal: `scripts/lib/linear/degraded-live.test.mjs:17` expects `# skipped 1` and gets `ℹ skipped 1`; `scripts/lib/linear/sandbox.test.mjs:752` finds no `# SKIP` line.
- `scripts/tracker-delete.test.mjs:200` expects `could not be removed: EACCES`; Node 26's `rmSync` on the read-only folder gives `ENOTEMPTY`. The message pmkit writes is still right.

Source: PMK-291, PR #241 (implementer, cycle 5).

### Scope (in)

- The child runs ask for the TAP reporter.
- The delete test accepts the code each Node version gives.

### Out of scope

- A CI matrix.

### Tasks

- [ ] Pass --test-reporter=tap to the child runs
- [ ] Loosen the error code in the delete test

## Acceptance criteria

- [ ] `npm test` exits 0 under Node 22 and under Node 26
- [ ] The delete test still checks that the cleanup failure is reported
