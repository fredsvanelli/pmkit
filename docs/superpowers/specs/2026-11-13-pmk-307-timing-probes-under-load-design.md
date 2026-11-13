# PMK-307: keep the other fixed 1 s timing probes from failing under load (design)

## Intent
The probes of `paths-timing`, `redact`, `cli-comment-redact` and `adr` tests use a fixed 1 s limit and failed in full `npm test` runs at load 50 to 170 (round 28). They must pass under load and still fail on quadratic time. PMK-303 solved this for `redact-probes.test.mjs`; this issue applies the same treatment.

## Goals / non-goals
- One shared helper, used by every probe file including `redact-probes`; a test of the helper (quadratic regex fails, linear passes).
- Per probe: a size where linear time stays far below the 10 s ceiling and the guarded regression goes far past it.
- Non-goals: changing `scripts/lib/paths.mjs`, `redact.mjs`, `adr.mjs`. Anti-goal: ratio or small fixed limits that load can flip.

## Approaches
1. Shared module `scripts/assert-fast.mjs` (chosen). `scripts/run-tests.mjs` globs `scripts/**/*.test.mjs`, so a non-test name is not run as a test.
2. Add to the existing `scripts/test-helpers.mjs`: it pulls in `makeRepo` and git, heavier for pure probes; rejected.
3. Ratio against a linear baseline: rejected in PMK-301/303.

## Design
- Helper exports `PROBE_CEILING_MS = 10000`, `assertFast(fn, input, limitMs = PROBE_CEILING_MS)` and `assertFastAsync` (CLI probe).
- Sizes (measured at load 30 to 70, Node 22; old versions from `3dabfe09^` paths, `eee5f132^` adr, `/\s+$/` of PMK-229):
  - paths-timing: 400k chars (linear max ~20 ms at 200k; old paths 436 ms at 20k, so about 43 s at 200k).
  - redact.test: 160k chars of word characters (linear 4 to 10 ms; a loaded run showed random spikes of 250 to 650 ms at larger sizes, still far below the ceiling).
  - cli-comment-redact: 200k blanks (old `/\s+$/` trim: 28 s at 50k; the CLI call cost is about 0.1 to 0.7 s, first call cold).
  - adr: 20000 repetitions (old adr takes minutes already at 300).
- The pipes probe (5 million pipes) drops `3 * redactMs + 1000` (review of PR #269: failed once in 24 loaded runs, redact 106 ms by chance against hideAbsolutePaths 3983 ms) and uses `assertFast` with its own ceiling of 60 s: linear time is 0.2 to 4 s at load 100 (15x margin at the worst), the quadratic version does not finish in minutes, and a stack overflow still throws.
- The helper lives in `scripts/assert-fast.mjs`, next to `test-helpers.mjs` (review of PR #269); its name does not match the test glob.
