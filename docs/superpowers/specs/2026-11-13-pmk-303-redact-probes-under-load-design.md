# PMK-303: keep the redact timing probes from failing under load (design)

## Intent
The two timing probes in `scripts/redact-probes.test.mjs` fail in full `npm test` runs on a loaded machine (fixed 1 s per input), yet must still catch a quadratic regex (PMK-288 kind).

## Goals / non-goals
- Pass under load (load 40 to 115); still fail on quadratic time; a test proves the second with a sample quadratic regex.
- Non-goal: change `scripts/lib/redact.mjs`. Anti-goal: a check that load can flip, such as a fixed 5 s limit at 80k or an n x 4n ratio (both failed in PMK-301).

## Approaches
1. Bigger size and a high ceiling (chosen): 320k characters per input, ceiling 10 s. Linear redact takes at most ~130 ms there (up to ~5 s with the 35x load slowdown seen); a quadratic regex takes ~100 s (`/a+b/` on 160k: 127 s). Absolute ceilings are robust because load only multiplies time, and the gap between linear and quadratic is far larger than any load factor.
2. Linear baseline in the same process: sturdier in theory, but needs a calibrated multiplier and two measurements that load can skew differently; more code.
3. Growth ratio n x 4n: rejected, failed in PMK-301.

## Design
- One helper `probeMs(fn, input)` and constants `PROBE_SIZE = 320000`, `PROBE_CEILING_MS = 10000`; both probes use it.
- Test of the helper: a sample quadratic regex (`/a+b/` over `a` x 30000, ~1 s) fails `assertFast` at a 200 ms limit; a linear one passes. The suite never waits for the 10 s ceiling.
- Left to the builder: exact file shape; time cost of 320k inputs is measured and reported.
