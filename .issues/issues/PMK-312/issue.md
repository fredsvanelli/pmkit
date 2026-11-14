---
id: PMK-312
title: Make a timing probe fail within its ceiling instead of hanging on a regression
type: chore
status: in_review
priority: low
estimate: 2
assignee: fred
parent: EPC-6
branch: pmk-312-make-a-timing-probe-fail-within-its
created: 2026-11-14T01:43:01.862Z
updated: 2026-11-14T02:54:25Z
---

## Description

### Context

PMK-303 and PMK-307 moved the timing probes to `assertFast` (`scripts/assert-fast.mjs`): it runs the function, then checks the time against a ceiling of 10 s (60 s for the pipes probe of `scripts/paths-timing.test.mjs`). The check comes only after the function returns, so a quadratic regression does not fail the probe at the ceiling: it holds the test run until the function ends. Checked at 80918e6f, with the measures of the PMK-307 review:

- The pipes probe on the `paths.mjs` before PMK-288 does not finish in minutes at 5 million characters; the ADR probe on the `adr.mjs` before its fix did not finish in 90 s; the trim of PMK-229 takes hundreds of seconds at 200 thousand blanks. `npm test` hangs that long before it reports the failure.
- A `timeout` on the test does not help: node:test cannot stop synchronous work. A test that busy-waits 3 s with `{ timeout: 300 }` passes (`ok`, 3038 ms) on Node 22.22.0.

The 1 s probes had the same limit before PMK-307. Source: PMK-307, PR #269 (review cycle 2).

### Scope (in)

- A synchronous probe runs where it can be stopped at its ceiling (for example a `worker_threads` Worker that is terminated, or a child process with a timeout) and fails with the same message when it passes the ceiling.
- The async probe of `scripts/cli-comment-redact.test.mjs` gets the same bound.
- The test of the helper shows that a quadratic function fails at the ceiling, not after it ends.

### Out of scope

- The ceilings and sizes PMK-307 chose.
- `scripts/lib/paths.mjs`, `scripts/lib/redact.mjs` and `scripts/lib/adr.mjs`.

### Tasks

- [ ] Run the probe where it can be stopped, and keep the message of `assertFast`
- [ ] Move every probe of PMK-307 to it
- [ ] Check the time of the probe files under load

## Acceptance criteria

- [x] A probe whose function runs past its ceiling fails within a few seconds of the ceiling, with the message that names the input and the time, shown by a test of the helper with a function that runs much longer than the ceiling
- [x] Every probe moved by PMK-307 uses the bounded helper and still passes in full `npm test` runs under load
