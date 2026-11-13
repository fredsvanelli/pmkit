---
id: PMK-303
title: Keep the redact timing probes from failing under load
type: chore
status: in_progress
priority: low
estimate: 1
assignee: fred
parent: EPC-6
branch: pmk-303-keep-the-redact-timing-probes-from
created: 2026-11-13T16:20:45.318Z
updated: 2026-11-13T18:09:23Z
---

## Description

### Context

`scripts/redact-probes.test.mjs` has two timing probes with a fixed 1 s limit per input: 80 thousand characters of ~50 patterns (line 290), and a table row of 320 thousand characters (line 304). In round 27 they failed in most full `npm test` runs while other workers ran suites on the same machine (load 40 to 115), on Node 22 and Node 26, and passed when the file ran alone. The same input took from 28 ms to over 1 s between runs.

The worker of PMK-301 suspected that redact grows faster than linear from 80k to 320k. That does not hold on a calmer machine (load ~26) at 7fee61b9, best of 3: `curl -u ` repeated takes 69, 137, 261 and 534 ms at 160k, 320k, 640k and 1280k characters, and `|token=[redacted]` 34, 65, 119 and 225 ms. Both double with the size. A growth check (n against 4n, fastest of 3 runs each) also proved unstable under load: the fast mode of the small input made ratios of 16 to 40 on linear inputs. Source: PMK-301, PR #256 (implementer, four questions).

### Scope (in)

- The probes stay able to catch a quadratic regex (the PMK-288 kind: tens of seconds at 200k) and stop failing because of load.
- A sample quadratic regex inside the test proves the probe still fails on one.

### Out of scope

- Changing `scripts/lib/redact.mjs`.

### Tasks

- [ ] Choose a measure that load does not break (for example a larger size with a ceiling that only quadratic time reaches, or comparing against a linear baseline run in the same process)
- [ ] Test it with a sample quadratic regex

## Acceptance criteria

- [x] The redact timing probes pass in full `npm test` runs with other suites running at the same time, with a check over several runs
- [x] A sample quadratic regex fails the probe, with a test
