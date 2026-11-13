---
id: PMK-307
title: Keep the other fixed 1 s timing probes from failing under load
type: chore
status: backlog
priority: low
estimate: 1
parent: EPC-6
created: 2026-11-13T21:09:10.403Z
updated: 2026-11-13T21:09:10Z
---

## Description

### Context

PMK-303 made the timing probes of `scripts/redact-probes.test.mjs` hold up under load: `assertFast` with a 10 s ceiling at 160 and 320 thousand characters, where linear time stays far below the ceiling and the PMK-288 kind of quadratic regex takes tens of seconds (`scripts/redact-probes.test.mjs:290-322`). Other probes still use a fixed 1 s limit, checked at 041bc521:

- `scripts/paths-timing.test.mjs`: six probes of 200 thousand characters (lines 17, 27, 37, 59, 69 and 79). The probe at line 49 compares with redact alone (`3 * redactMs + 1000`).
- `scripts/redact.test.mjs:160`: 80 thousand word characters.
- `scripts/cli-comment-redact.test.mjs:74`: `issues comment --redact` on 50 thousand blanks, through the CLI, with `Date.now()`.
- `scripts/adr.test.mjs:1486`: `adrInfo` on long bodies.

In round 28 the paths-timing probes (`no ://` at 1009 ms, quotes and backticks, the PMK-295 pipes probe) and the `cli-comment-redact` probe failed in full `npm test` runs while other workers ran suites (load 50 to 170), on Node 22, and passed when their file ran alone. Source: PMK-303, PR #264 (implementer), and the reviewers of PR #261, #262 and #263.

### Scope (in)

- These probes get the PMK-303 treatment: one shared helper (for example `assertFast` moved to a module the test files import), a size where linear time stays far below a high ceiling and the regression each probe guards goes past it.
- The probe at line 49 keeps its comparison with redact alone if that already holds up under load; check it.

### Out of scope

- Changing `scripts/lib/paths.mjs`, `scripts/lib/redact.mjs` or `scripts/lib/adr.mjs`.

### Tasks

- [ ] Share the helper and move each probe to it, with a size per probe
- [ ] Check under load over several runs

## Acceptance criteria

- [ ] The probes listed pass in full `npm test` runs with other suites running at the same time, with a check over several runs
- [ ] Each probe still fails on a quadratic input of its kind, shown by a test of the shared helper and by the size each probe uses
