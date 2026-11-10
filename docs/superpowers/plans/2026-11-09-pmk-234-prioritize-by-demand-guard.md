# PMK-234 plan: guard the prioritize-by-demand write

Spec: `docs/superpowers/specs/2026-11-09-pmk-234-prioritize-by-demand-guard-design.md`.

**Files:** `commands/backlog/prioritize-by-demand.md`, `scripts/__scenarios__/backlog-prioritize-by-demand.mjs` (+ regenerated `.after.txt` goldens), `scripts/scenarios.test.mjs` / `scripts/scenarios-live.mjs` only if counts or `LIVE_EXPECT_STOPS` need it, `CHANGELOG.md`, `README.md` and `skills/pmkit/SKILL.md` (description line), `.issues/` (criteria checks).

- [ ] **1. Scenario first (TDD).** Add two entries. (a) Stale: requests give ISS-6J0B urgent and ISS-3F7H high; after the step 7 confirm, an `edit` changes ISS-3F7H's priority on disk; the re-run dry run is `before` != previewed; no write; `expect` checks ISS-6J0B and ISS-3F7H have no new events. (b) Rank-only: answers `[]`, steps are the reads, `notHit` Step 5 and 7, skip steps 6 and 9; `expect` checks no new events on any candidate. Existing entries gain the re-check dry runs after `Step 7`. Run `node --test scripts/scenarios.test.mjs`, expect FAIL.
- [ ] **2. Command file.** Edit Parameters, step 5 (rank-only stop), step 6 (keep `before`), step 8 (re-check, stale handling, ceiling), Confirmation points, Output and If something is missing. Run the scenario test, expect the entries to pass; `UPDATE_GOLDENS=1` and read the diff.
- [ ] **3. Docs.** `CHANGELOG.md` line at the top of `## Unreleased`; README and SKILL.md description lines. No new command, so no count changes; check with `node --test scripts/plugin.test.mjs`.
- [ ] **4. Verify.** `npm test` in the foreground, exit code 0.
- [ ] **5. Close.** Check both criteria with `issues update PMK-234 --check <n>` (dry run, then real), commit `.issues/`, open the PR.
