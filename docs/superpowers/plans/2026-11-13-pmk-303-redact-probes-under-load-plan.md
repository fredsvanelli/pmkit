# PMK-303 plan

1. TDD: add `assertFast(fn, input, limitMs)` to `scripts/redact-probes.test.mjs` plus a test that a sample quadratic regex (`/a+b/` on 15000 `a`, limit 20 ms; the linear case runs under the 10 s ceiling) makes it throw and a linear function passes. Run; the helper test fails first (helper absent), then passes.
2. Switch the probes to a 10 s ceiling (`PROBE_SIZE = 160000` for the 47-pattern probe, `PROBE_ROW_SIZE = 320000` for the table row; a first try at 320k for both made the file 3 to 4 times slower) through the helper (the 80k probe's repeat counts scale with `n`, as they already do).
3. Run the file 5+ times under a parallel `npm test` load on Node 22 and Node 26; record times and load.
4. CHANGELOG line under `## Unreleased`; check criteria 1 and 2; full `npm test` in the foreground on Node 22 and 26; PR.
