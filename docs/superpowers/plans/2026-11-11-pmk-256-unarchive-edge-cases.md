# PMK-256 plan

Spec: `docs/superpowers/specs/2026-11-11-pmk-256-unarchive-edge-cases-design.md`. Each task is test first.

1. **Events** (`scripts/events.test.mjs`, `scripts/lib/local/events.mjs`): test that archive, unarchive, archive, unarchive with distinct times, repeated whole, reads as 4 events; the same-second test keeps passing. Fix: a repeated flip is kept only when the last kept event has the same `at`.
2. **View message** (`scripts/bulk.test.mjs`, `scripts/cli-bulk.test.mjs`, `scripts/lib/bulk.mjs`): test that a view without archived says to save the view with `--archived`, and the flag form keeps its text. Fix `checkBulkFilter`.
3. **Linear first** (`scripts/cli-bulk-linear.test.mjs`, `scripts/lib/errors.mjs`, `scripts/pmkit.mjs`, `scripts/lib/linear/tracker.mjs`): test `bulk unarchive --view x` and a bad value on Linear answer `NOT_SUPPORTED` with no mutation. Move the check to the top of `runBulk`, share the error.
4. **Limits** (`scripts/cli-bulk.test.mjs`): test 3 live issues plus 1 archived with `--max 1` is not refused.
5. `CHANGELOG.md` line, tick the 4 criteria, `npm test`, PR.
