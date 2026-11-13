# PMK-303 plan

1. TDD: add `assertFast(fn, input, limitMs)` to `scripts/redact-probes.test.mjs` plus a test that a sample quadratic regex (`/a+b/` on 30000 `a`, limit 200 ms) makes it throw and a linear function passes. Run; the helper test fails first (helper absent), then passes.
2. Switch both probes to 320k characters per input and a 10 s ceiling through the helper (the 80k probe's repeat counts scale with `n`, as they already do).
3. Run the file 5+ times under a parallel `npm test` load on Node 22 and Node 26; record times and load.
4. CHANGELOG line under `## Unreleased`; check criteria 1 and 2; full `npm test` in the foreground on Node 22 and 26; PR.
