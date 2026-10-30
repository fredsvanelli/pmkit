# Deploys and CI logs in the GitHub git host (PMK-49)

## Intent

The MVP skills spec lists `list_deploys` and `ci_logs` as the git host operations not built yet. investigate-bug, release-readiness and risk-radar need them (PMK-63, PMK-69 depend on this issue). This issue adds both to the GitHub host and exposes each as a CLI command.

## Goals

- `createGithubHost` gets `listDeploys({ environment, limit })`, which returns the repository deployments with the state of the latest status of each.
- `createGithubHost` gets `ciLogs({ branch, runId })`, which returns the log of the failed steps of a run.
- The CLI gets `deploys list` and `ci logs`, both read-only, both failing with the same `NOT_SUPPORTED`, `NOT_CONFIGURED` and `AUTH` errors as `pr status`.

## Non-goals

- No new capability. `linked_code` already covers git host data, so only its `SERVED_BY` list grows and the goldens stay the same.
- No command file under `commands/` and no skill change. PMK-63 and PMK-69 consume the CLI.
- No log search or log storage.

## Decisions

- `listDeploys` calls `gh api repos/{owner}/{repo}/deployments?per_page=<limit>` (plus `&environment=<name>` when given), then `gh api repos/{owner}/{repo}/deployments/<id>/statuses?per_page=1` for each deployment. A deployment without a status has state `pending`. Default limit 20, maximum 100.
- Each deployment is `{ id, environment, ref, sha, createdAt, state, url }`. `url` is the `log_url` or `target_url` of the latest status, or null.
- `ciLogs` with `runId` runs `gh run view <runId> --log-failed`. Without it, the host reads `listRuns({ branch })`, takes the newest run whose conclusion is `failure`, and reads its log. When no run failed it returns null. The result is `{ runId, workflowName, url, log }`.
- The CLI keeps the last `--tail` lines of the log (default 200) and reports `truncated` in the data, because a failed log can run to megabytes.
- `ci logs` takes `--branch` (default: the current branch) or `--run <id>`. `--run` must be digits.
- My call (not stated in the issue): the issue says "the log of a failed check", and `gh pr checks` links to a run, so a run id is the unit.
