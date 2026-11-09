# PMK-184: deploys list and ci logs fixes

Source: PMK-49, PR #79 second review. Out of scope: `docs/superpowers/epc-6-follow-ups.md`.

## Decisions

1. `deploys list --environment` with no value (`parseArgs` gives `true`) answers `INVALID_INPUT` before `gh` runs, like the empty string. The same guard covers `ci logs --branch` with no value.
2. `ci logs` reads the run's `conclusion` and `status`. With `--run`, one `gh run view <id> --json workflowName,url,conclusion,status` call fills `workflowName`, `url`, `conclusion`, `status`. A branch lookup already has them.
3. `run` in the JSON gains `conclusion`, `status`, `failed` (conclusion is in `FAILED_RUN`), `hasLog` (log is not blank) and `logNote` (string or null). The text prints `logNote` when it is set. Exit stays 0.
4. `logNote` cases: run not finished (no conclusion): "has not finished"; finished and not failed: "did not fail (<conclusion>), so it has no failed-step log"; `startup_failure`: "never started a job, so it has no log"; failed with blank log: "failed (<conclusion>) but GitHub returned no log for it".
5. For a run that did not fail or is `startup_failure`, `gh run view --log-failed` is not called: its log is empty by definition.

## Non-goals

No new flags, no change to which runs count as failed.
