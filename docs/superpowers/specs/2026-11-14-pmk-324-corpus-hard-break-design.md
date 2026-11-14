# PMK-324: status lines with a hard break in the adr-commonmark-diff corpus (design)

Small change (estimate 1). Only `scripts/dev/adr-commonmark-diff.mjs` (the corpus), plus a CHANGELOG line. `scripts/lib/adr.mjs`, `adr-write-compare.mjs` and its test do not change.

## Why
Since PMK-321 `compareWrites` checks that an in-place write keeps the old line's hard break (`hardBreak`: two or more trailing spaces, or an odd number of trailing backslashes). The corpus has no backslash at all and trailing spaces only in the 40 `  Accepted  ` container cases, so a head that drops a `\` break passes the full run, and the pairs, triples and random status runs never write over any hard break.

## Goals
- A new list `STATUS_BREAKS` of status lines ending in a hard break or a near miss: two or three spaces (`Accepted  `, `**Accepted**   `, `  Proposed  `), one backslash (`Accepted\`, `**Superseded by ADR 2**\`, `  Proposed\`), two backslashes, not a break (`Accepted\\`, `_Deprecated_\\`), and three, a break (`Accepted\\\`).
- New cases appended after `yield* CONTAINERS`, mirroring the PMK-315 status cases with `STATUS_ALL = [...STATUSY, ...STATUS_BREAKS]`, keeping only the combinations that hold at least one line of `STATUS_BREAKS` (the others are already in the corpus):
  - pairs `b, x, u` (b in STATUS_BREAKS, x in STATUS_ALL + ALPHABET) and `a, b, u`;
  - triples `s, t, x, u` and `s, a, t, u` with s or t in STATUS_BREAKS;
  - random runs weighted like the PMK-315 ones but drawing status lines from `STATUS_ALL`, with their own seed (`seed + 2`) and count `--break-random` (default 250,000).
- The old cases stay byte for byte and in order: `STATUS_WORDS`, `STATUSY` and the random state of the old runs are not touched (the new random runs reseed after `CONTAINERS`).

## Non-goals
- No change to `adr.mjs` or to `compareWrites`/`hardBreak`; no loosening if develop gives worse cases (that goes to the coordinator).
- The other PMK-321 notes (spec exception, `STATUS` drift test, tautological expectation).

## Approaches
1. Append new generators over a separate `STATUS_BREAKS` list (chosen): old prefix unchanged, cost bounded by keeping only combinations with a break line.
2. Add the lines to `STATUS_WORDS`: simplest diff, but it changes every pair, triple and the random draws of the old status runs, so the old cases do not stay the same and in order. Rejected.
3. Full cross product of `STATUS_ALL` (all triples again): ~1.8M extra cases mostly already covered. Rejected for run time.

## Size and run time (spike, uncommitted, at develop 3fb6707b)
2,690,400 + 1,232,926 = 3,923,326 cases; `--base 3f24c7e6 --head origin/develop` exits 0 with 0 worse in 2 min 25 s (was ~1 min 45 s, about 1.4x, under the 2x bound). The count can be lowered with `--break-random`.

## Tests
No unit test changes: the corpus lives in the script, outside `npm test` (it needs commonmark). The red/green is the mutation run: with `hardBreak` in a temporary copy of `adr.mjs` dropping the `\` break (and, separately, the space break), the full run must exit 1 at the head `worktree`, where the old corpus exits 0 for the `\` one.

## Evidence for the PR
- Old prefix: a scratch script (outside the repo) hashes the case sequence of the script at develop and the first 2,690,400 cases of the new one: same count, same hash; new total 3,923,326.
- Full run 3f24c7e6 -> develop: exit 0, 0 worse, cases and run time.
- Mutations (temporary patch on `scripts/lib/adr.mjs`, reverted, `--head worktree`): `\` break dropped -> exit 1 with its worse count; space break dropped -> exit 1 with its worse count; no mutation -> exit 0.
