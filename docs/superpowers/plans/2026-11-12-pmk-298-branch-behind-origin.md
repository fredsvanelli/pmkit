# PMK-298 plan

Spec: `docs/superpowers/specs/2026-11-12-pmk-298-branch-behind-origin-design.md`

1. Tests first (`scripts/cli-pr.test.mjs`): `behindRepo(n)` clone with the local default n commits behind. Behind (2, 1) -> count and next step on dry run and real run; diverged (1 here, 3 there) -> both counts, no pull, and the real run's rebase command works; `rev-list` that fails (missing parent object) -> "could not compare" on both runs; level, ahead only, `--from` -> no note. Notes are in `data.notes` and on stderr, not in stdout.
2. `branchBase` in `scripts/pmkit.mjs`: `rev-list --left-right --count`, return `sync`.
3. `syncNotes(from, sync, created)`: dry-run wording (pull / `--from`) and real-run wording (`git rebase --onto origin/<default> <default> <branch>`).
4. `issues branch`: dry run uses `syncNotes(from, sync)`, real run `syncNotes(from, sync, branch)`.
5. `commands/issues/work.md` step 6, README row, CHANGELOG line.
6. Check both acceptance criteria, commit `.issues/`, `npm test` (Node 22) in foreground, PR.
