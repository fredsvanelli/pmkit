# PMK-312: timing probes fail at their ceiling

## Intent

`assertFast` (PMK-303, PMK-307) checks the time after the function returns, so a quadratic regression holds `npm test` for
minutes before it reports. A `timeout` of node:test does not stop synchronous work (a 3 s busy-wait with `{ timeout: 300 }`
passes on Node 22.22.0). The probe has to fail a few seconds after its ceiling.

## Goals / non-goals

- Goals: the probe fails within a few seconds of the ceiling with the same message (input and time); the async CLI probe gets the
  same bound; nothing is left running; every probe of PMK-307 uses it.
- Non-goals: ceilings and sizes of PMK-307; `scripts/lib/paths.mjs`, `redact.mjs`, `adr.mjs`.

## Approaches

1. **`worker_threads` Worker, terminated at the ceiling (chosen).** `terminate()` interrupts synchronous JS, including a
   backtracking regex (measured: a 60 s loop and a quadratic regex both stop at 1000 ms + about 300 ms). The Worker lives in the
   test process, so the leak guard of `run-tests.mjs` and the node:test cleanup see nothing left. Cost: about 0.2 s of start per
   call, paid once per call because one Worker takes all the inputs of a probe.
2. Child process with `spawnSync` timeout. Kills for sure and has no module limits, but costs 50 to 100 ms more per start, needs
   the input over stdin or argv (5 million characters), and a killed child that spawned its own children can leak.
3. `timeout` of node:test. Rejected: it cannot stop synchronous work.

## Design

- `assertFast(spec, inputs, limitMs = PROBE_CEILING_MS, names = inputs)` is async. `spec` is `'lib/redact.mjs#redact'`, a module
  relative to `scripts/` and the export to call (sync or async). A Worner takes no closures, so the probe names the export.
  `assertFastAsync` goes away: an async export is awaited in the Worker.
- One Worker per call runs the inputs in order. The input is posted as a string (cloned: 10 MB for the biggest, a few ms), so
  nothing is built in the Worker. A parent timer ends the wait at the ceiling and terminates the Worker; the Worker start is not
  counted in the time.
- Message: `"<first 20 characters of the input>" took <ms> ms`, with ` (stopped at the ceiling of <n> ms)` when it was stopped.
  `names` replaces the shown input when the input is not a string, or when it is built from a body (the ADR probe).
- Two small modules for probes that were closures: `scripts/probe-targets.mjs` exports `adrInfoBody` (the ADR document around a
  body) and `commentRedact` (the CLI probe, in a Worker; the repo and the body file are made by the test in the main thread, so
  the temp folder is cleaned as before).

## Checks

- Helper test: a 60 s loop with a 1 s ceiling fails in under 5 s; a quadratic regex stops at the ceiling; a linear call passes;
  an error thrown in the export surfaces; no Worker is left (`process.getActiveResourcesInfo()` has no new `Worker`).
- Time of the probe files before and after, unloaded and with two parallel `npm test`, on Node 22.22.0 and 26.4.0.
