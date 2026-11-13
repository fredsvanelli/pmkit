# PMK-307 timing probes under load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task.

**Goal:** Every fixed 1 s timing probe uses one shared `assertFast` with a 10 s ceiling and a size where only quadratic time reaches it.

**Architecture:** `scripts/__helpers__/assert-fast.mjs` (not matched by the `scripts/**/*.test.mjs` glob) holds the helper; test files import it.

**Tech Stack:** node:test, ESM.

**Spec:** `docs/superpowers/specs/2026-11-13-pmk-307-timing-probes-under-load-design.md`

## Global Constraints
- Do not change `scripts/lib/paths.mjs`, `redact.mjs`, `adr.mjs`.
- Ceiling `PROBE_CEILING_MS = 10000`; commits carry `(PMK-307)` and the Co-Authored-By trailer.

## Review Focus
- A mild quadratic with a small constant can pass a ceiling probe (known limit, as in PMK-303): sizes are chosen so old regressions fail by 4x or more.
- The CLI probe includes a cold first call: covered by the ceiling.
- The pipes probe stays relative to redact: checked in the load runs.

---

### Task 1: Shared helper and its test
**Files:** Create `scripts/__helpers__/assert-fast.mjs`, `scripts/assert-fast.test.mjs`; modify `scripts/redact-probes.test.mjs:290-322`.
**Produces:** `PROBE_CEILING_MS`, `assertFast(fn, input, limitMs = PROBE_CEILING_MS)`, `assertFastAsync(fn, input, limitMs = PROBE_CEILING_MS)` (awaits `fn`).
- [ ] Write `scripts/assert-fast.test.mjs`: `/a+b/` over `'a'.repeat(15000)` throws `/took [\d.]+ ms/` at 20 ms; `/a/` passes at the ceiling; async variant likewise. Run: fails (module missing).
- [ ] Create the helper (moved from redact-probes); remove the local copy and test from `redact-probes.test.mjs`, import the helper. Run both files: pass.
- [ ] Commit.

### Task 2: paths-timing, redact and adr probes
**Files:** modify `scripts/paths-timing.test.mjs` (`n = 400000`, loops use `assertFast`, pipes probe unchanged), `scripts/redact.test.mjs:160` (400000 chars), `scripts/adr.test.mjs:1486` (`n = 20000`).
- [ ] Replace each 1 s loop with `assertFast`; run the three files: pass.
- [ ] Commit.

### Task 3: CLI probe
**Files:** modify `scripts/cli-comment-redact.test.mjs:74` (200000 blanks, `assertFastAsync`).
- [ ] Change and run: pass. Commit.

### Task 4: Proof, docs, delivery
- [ ] Time the touched files alone and under load (5+ rounds with a parallel `npm test`), Node 22; full `npm test` exit 0.
- [ ] CHANGELOG line under `## Unreleased`; check criteria; commit `.issues/`.
