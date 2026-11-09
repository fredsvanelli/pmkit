# PMK-200 plan

Spec: `docs/superpowers/specs/2026-11-09-pmk-200-view-error-reason-design.md`. TDD: each task writes the failing test first.

1. **Reasons on the errors.** Test in `scripts/views.test.mjs`: `runView('../x')`, `runView('stale')`, `runView('broken')` carry `details.reason` `invalid_view_name`, `view_out_of_date`, `view_file_broken`; a reworded message does not matter. Implement in `scripts/lib/local/views.mjs` (`bad`) and `scripts/lib/local/tracker.mjs` (`requireViewName`, `runView`).
2. **JSON output.** Test in `scripts/cli.test.mjs`: `views run` errors print `error.reason`. Implement in the error branch of `scripts/pmkit.mjs`.
3. **Command file.** `commands/issues/run-view.md` step 4 reads `error.reason`.
4. **Scenarios.** `scripts/__scenarios__/issues-run-view.mjs` becomes an array: success, not found, invalid name, out of date, broken file, Linear. Regenerate snapshots, update `scripts/scenarios.test.mjs` counts if any.
5. **Changelog, criteria, verify.** `CHANGELOG.md` line, `issues update PMK-200 --check 1/2`, `npm test` in the foreground (exit 0).
