# PMK-267 plan

Spec: `docs/superpowers/specs/2026-11-12-pmk-267-unarchive-one-second-and-linear-flags-design.md`

- [ ] Add the failing tests (events one-second merge run; Linear bulk unarchive with `--limit`).
- [ ] `parseEvents`: collect the events, drop the second half of an equal-halves group of flips with the same `at`, then run the PMK-256 dedupe.
- [ ] `run` in `scripts/pmkit.mjs`: refuse `issues bulk unarchive` on a non-local tracker before `checkUsage`.
- [ ] CHANGELOG line under Unreleased.
- [ ] Check both acceptance criteria in the issue, `npm test` in the foreground with exit code 0, open the PR.
