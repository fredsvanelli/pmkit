# PMK-324: hard-break status lines in the corpus, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, small task). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the adr-commonmark-diff corpus writes over status lines ending in 2+ spaces, one backslash and two backslashes, in pairs, triples and random status runs, with the old cases unchanged and in order.

**Architecture:** the corpus (its lists and the `cases` generator) moves, unchanged, from `adr-commonmark-diff.mjs` into `adr-write-compare.mjs`, the module of pure helpers that `npm test` can import without commonmark. The new cases are three exported generators appended at the end of `cases`. The script imports `cases`.

**Tech Stack:** Node 22 ESM, `node:test`, no dependencies (ADR 0003).

**Spec:** `docs/superpowers/specs/2026-11-14-pmk-324-corpus-hard-break-design.md`, plus the coordinator's addition at approval: a test in `adr-write-compare.test.mjs` (red first) that the generator yields the three kinds of line in pairs, triples and random runs.

## Global Constraints
- Only `scripts/dev/` and CHANGELOG; never `scripts/lib/adr.mjs`.
- The first 2,690,400 cases are byte-identical and in order to develop's (prefix hash, scratch script outside the repo).
- Mutations are temporary patches, reverted; never committed.

## Review Focus
- A break line as the last line before the underline (setext): covered, `u` follows every pair and triple.
- A break line second in the section (`a, b, u` and `s, a, t, u`): covered.
- `\\` (even, not a break) and `\\\` (odd, a break): both in `STATUS_BREAKS`.
- Old random state disturbed by the move: caught by the prefix hash.

---

### Task 1: corpus in the helper module, break cases, test

**Files:** Modify `scripts/dev/adr-write-compare.mjs`, `scripts/dev/adr-commonmark-diff.mjs`, `scripts/dev/adr-write-compare.test.mjs`.

**Interfaces (Produces, from adr-write-compare.mjs):**
- `STATUS_BREAKS: string[]`: `['Accepted  ', '**Accepted**   ', '  Proposed  ', 'Accepted\\', '**Superseded by ADR 2**\\', '  Proposed\\', 'Accepted\\\\', '_Deprecated_\\\\', 'Accepted\\\\\\']` (JS literals).
- `breakPairs(): Generator<string>`, `breakTriples(): Generator<string>`: only combinations of `[...STATUSY, ...STATUS_BREAKS]` with a break line in a status slot.
- `breakRuns({ seed: number, count: number, lines: number }): Generator<string>`: random status runs drawing from `[...STATUSY, ...STATUS_BREAKS]`, seeded `seed + 2`.
- `cases({ seed, random, statusRandom, breakRandom, lines }): Generator<string | { text, end }>`: the whole corpus, old part first.

- [ ] **Step 1: failing test** `the corpus writes over status lines with a hard break in pairs, triples and random runs (PMK-324)`: for each of `breakPairs()`, `breakTriples()`, `breakRuns({ seed: 1, count: 2000, lines: 8 })`, some case has a line ending in `/[^ ] {2,}$/`, in `/[^\\]\\$/` and in `/[^\\]\\\\$/`.
- [ ] **Step 2:** `node --test scripts/dev/adr-write-compare.test.mjs`: FAIL (imports missing).
- [ ] **Step 3:** move the lists, `CONTAINERS` and `cases` into adr-write-compare.mjs; a `prng(seed)` and a `randomRun(random, kinds, lines, underline)` helper shared by the three random parts (same call order as before); add `STATUS_BREAKS`, the three generators and `yield*` them after `CONTAINERS`; the script calls `cases({ ..., breakRandom: Number(args['break-random']) })` with new option `--break-random` default `250000`; header comments updated.
- [ ] **Step 4:** test file PASS; `npm test` exit 0.
- [ ] **Step 5:** prefix proof (scratch script hashing develop's `cases()` vs the first N of the new one): same count 2,690,400, same hash; new total 3,923,326.
- [ ] **Step 6:** commit `feat(dev): hard-break status lines in the adr-commonmark-diff corpus (PMK-324)`.

### Task 2: evidence, CHANGELOG
- [ ] Full run `--base 3f24c7e6 --head origin/develop` timed: exit 0, 0 worse.
- [ ] Temp patch `hardBreak` in `scripts/lib/adr.mjs` to drop the `\` break, `--head worktree`: exit 1, worse count; revert. Same for the space break. With the old corpus (develop's script) the `\` mutation exits 0 (the red).
- [ ] Unpatched `--head worktree`: exit 0. `git diff scripts/lib` empty.
- [ ] CHANGELOG line with counts and time; commit.
