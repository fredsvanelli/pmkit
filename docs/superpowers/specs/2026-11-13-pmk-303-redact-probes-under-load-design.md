# PMK-303: keep the redact timing probes from failing under load (design)

## Intent
The two timing probes in `scripts/redact-probes.test.mjs` fail in full `npm test` runs on a loaded machine (fixed 1 s per input), yet must still catch a quadratic regex (PMK-288 kind).

## Goals / non-goals
- Pass under load (load 40 to 115); still fail on quadratic time; a test proves the second with a sample quadratic regex.
- Non-goal: change `scripts/lib/redact.mjs`. Anti-goal: a check that load can flip, such as a fixed 5 s limit at 80k or an n x 4n ratio (both failed in PMK-301).

## Approaches
1. Bigger size and a high ceiling (chosen): ceiling 10 s, 160k characters per input in the 47-pattern probe and 320k in the table-row probe. Linear redact takes well under a second per input there (up to a few seconds with the 35x load slowdown seen); a hard quadratic regex takes tens of seconds or more at 160k (`/a+b/`: 127 s in the implementer's run, 27 s in the reviewer's). Absolute ceilings are robust because load only multiplies time, and the gap between linear and quadratic is far larger than any load factor. A first version used 320k for both probes; it made the file 3 to 4 times slower, so the 47-pattern probe went down to 160k.
2. Linear baseline in the same process: sturdier in theory, but needs a calibrated multiplier and two measurements that load can skew differently; more code.
3. Growth ratio n x 4n: rejected, failed in PMK-301.

## Design
- One helper `assertFast(fn, input, limitMs)` and constants `PROBE_SIZE = 160000`, `PROBE_ROW_SIZE = 320000`, `PROBE_CEILING_MS = 10000`; both probes use it.
- Test of the helper: a sample quadratic regex (`/a+b/` over `a` x 15000, ~0.13 s on a quiet machine) fails `assertFast` at a 20 ms limit; a linear one passes under the 10 s ceiling (a 20 ms limit on the linear case flaked under load 150). The suite never waits for the 10 s ceiling.

## Known limit (measured by the reviewer)
The ceiling catches hard quadratic time, not a mild one. `token=[^\n]*x` takes 3.2 s at 160k and 11 s at 320k: it passes the 160k probe and fails only the 320k table-row probe. A regex that is quadratic with a small constant can pass the 160k probe. Raising the size of the 47-pattern probe would catch it but costs file time; left as is.
