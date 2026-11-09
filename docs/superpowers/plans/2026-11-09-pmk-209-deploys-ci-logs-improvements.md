# PMK-209 plan

Spec: `docs/superpowers/specs/2026-11-09-pmk-209-deploys-ci-logs-improvements-design.md`. TDD, one commit per task, each with `(PMK-209)`.

1. **Deploy statuses (AC 1).** Tests in `scripts/github-host.test.mjs`: two calls (REST list + one graphql with all ids), lowercased state, no-status = pending, graphql UPSTREAM failure = rows with `state: null` and `statusError`, null node = unknown, AUTH still throws, empty list makes no graphql call. Update `deploys list` CLI text/warning and its test in `cli-deploys-ci.test.mjs`. Implement in `scripts/lib/github/host.mjs` and `scripts/pmkit.mjs`.
2. **Checks to runs (AC 2).** Tests: `prChecks` returns `link` and `runId` (null without a run link); `pr status` text and JSON show it; `pr blockers` failing checks carry `runId`. Implement.
3. **Age of the failure (AC 3).** Tests: `ciLogs` by branch returns `createdAt`, `headSha`, `newerRun` when a newer completed run of the workflow passed (and none when it failed or is in progress); `--run` returns `createdAt`/`headSha` and no `newerRun`; CLI note. Implement; update `commands/issues/investigate-bug.md` step 4 and goldens/scenarios that the tests flag.
4. **Tail (AC 4).** Unit test of the tail helper (CRLF-free, final newline kept, n larger than the log, exactly n lines, empty log) and the existing CLI tail tests stay green. Implement.
5. **Docs.** `CHANGELOG.md` line under `## Unreleased`, `README.md` rows for `deploys list`, `ci logs`, `pr status`; `skills/pmkit/SKILL.md` if it describes them.
6. **Close.** `issues update PMK-209 --check 1..4` (dry-run, real), commit `.issues/`, `npm test` in the foreground (exit 0), then deliver (PR, comment, `in_review`).
