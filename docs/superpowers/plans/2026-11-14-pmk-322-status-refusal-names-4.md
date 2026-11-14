# PMK-322 plan: name the status the reader sees, and each fence apart

Design: `docs/superpowers/specs/2026-11-14-pmk-322-status-refusal-names-4-design.md` (approved by the orchestrator, delegated by the user).
Test command: `node --test scripts/adr.test.mjs` for the loop, `npm test` for the gate.

## Task 1: status line (TDD)
1. Add failing tests to `scripts/adr.test.mjs` after the PMK-319 status tests: `adrStatusDropped` and `adr-status` (dry run and real, file unchanged) for
   - `    Accepted`, blank, `> Proposed` -> dropped `['Accepted']`, `"> Proposed"` not named
   - `[Accepted]: /u`, blank, `> Proposed` -> dropped `['[Accepted]: /u']`
   - `Date: x`, blank, `> see ADR 3`, `Accepted` -> dropped `['> see ADR 3', 'Accepted']`
   - `Date: x`, blank, `- see ADR 3`, `Accepted` -> dropped `['- see ADR 3', 'Accepted']`
   - unchanged controls: `    Accepted`, blank, `Some text` keeps the first line; `Date: x` glued to `Accepted` still names `Date: x`; `Superseded by: ADR 3` first line unchanged.
2. Run: they fail for the first four.
3. `sectionEnd`: record `held.lazy` (the line index) in its lazy branch.
4. `statusSection`: `inBlock()` adds `held.lazy` to the set.
5. `statusLineOf`: the `paragraph(i)` predicate gates the first-line short-circuit and the later candidate.
6. Run: pass. Commit `fix(adr): name the status line the reader sees in the refusal (PMK-322)`.

## Task 2: fence names (TDD)
1. Change the PMK-319 "as N fences" test to assert each fence named with its own line, and add: the `adr-get` note for two same-opener fences names each fence with its line; a single-fence refusal and note are byte-identical to the develop text, and `fenceHeld` JSON is `{ opener, lines }`.
2. Run: fail.
3. `adrFenceBlocks` adds `lines` (grouped by block, one pass); `runAdrStatus` gives one cause per fence and dedupes fix steps; `runAdrGet` builds the note from `adrFenceBlocks`.
4. Run: pass. Commit `fix(adr): name each fence with its lines in the refusal and adr-get (PMK-322)`.

## Task 3: probe and evidence
1. Probe test: `Date: x`, blank, `> see ADR 3`, then 20,000 lazy `Accepted` lines, via `assertFast`. Time it on develop and the branch.
2. Comparison script in the scratchpad: 150,000 seeded random Status bodies, develop worktree x branch: refused, nextStep, notes, written text, adr-get status equal; classify message diffs (case 1 code/def first line, case 2 lazy line, case 3 fences), 0 unexplained; count first-line-short-circuit diffs where no later line reads as a status (expect 0); timing.
3. `node scripts/dev/adr-commonmark-diff.mjs` cross-check.

## Task 4: ship
CHANGELOG line, `/utils:review-work`, `npm test` exit 0, PR via pmkit CLI, comment, move to in_review.
