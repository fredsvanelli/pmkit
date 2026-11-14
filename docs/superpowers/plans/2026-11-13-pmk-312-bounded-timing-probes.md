# PMK-312 Implementation Plan

> Run with superpowers:executing-plans, inline. Spec: `docs/superpowers/specs/2026-11-13-pmk-312-bounded-timing-probes-design.md`.

**Goal:** a timing probe fails within a few seconds of its ceiling and leaves nothing running.

- [ ] 1. Test first (`scripts/assert-fast.test.mjs`): loop of 60 s with a 1 s ceiling fails in under 5 s with `/took [\d.]+ ms/` and the stopped note; quadratic regex fails; linear passes; async export awaited; a throw surfaces; no Worker left.
- [ ] 2. `scripts/assert-fast.mjs` + `scripts/assert-fast-worker.mjs` (a Worker per call; the parent ends the wait at the ceiling and terminates it). Remove `assertFastAsync`.
- [ ] 3. Move the probes: `paths-timing`, `redact-probes`, `redact.test` (`lib/paths.mjs#hideAbsolutePaths`, `lib/redact.mjs#redact`), `adr.test` (`probe-targets.mjs#adrInfoBody`, names = bodies), `cli-comment-redact.test` (`probe-targets.mjs#commentRedact`). Tests become `async`. Ceilings and sizes unchanged.
- [ ] 4. Measure the probe files before and after, unloaded and loaded (two parallel `npm test`), Node 22.22.0 and 26.4.0.
- [ ] 5. CHANGELOG line under `## Unreleased`; check the acceptance criteria; `npm test` in the foreground (exit 0).
