# PMK-209: deploys list and ci logs improvements

Source: PMK-49 follow-ups (`docs/superpowers/epc-6-follow-ups.md`). None is a defect. Autonomous run: the choices below are the implementer's calls.

## Decisions

1. **Deployment statuses in one GraphQL query.** The REST list call stays (it keeps the `environment` and `ref` filters that `release-readiness` needs). Its `node_id`s go to one `gh api graphql` call: `nodes(ids: $ids) { ... on Deployment { databaseId latestStatus { state logUrl environmentUrl } } }`. Total: two calls, not 1 + N. The state is lowercased as before; no status at all is still `pending`.
2. **A failed status read no longer loses the list.** On an `UPSTREAM` error from the query, or a node GraphQL returns as `null`, each row keeps its deployment and gets `state: null` plus `statusError` (the message). Never `pending`: an unknown state is not "nothing happened" (lessons, round 3). `AUTH`, `RATE_LIMITED` and `NOT_CONFIGURED` still throw. The text prints `unknown` and the command adds a warning once.
3. **Failing check linked to `ci logs`.** `prChecks` also asks for `link`. Each check gets `runId`, parsed from `/actions/runs/<id>` in the link, or `null` (status contexts, other CI). `pr status` text shows `ci logs --run <id>` next to a failing check, and `data.checks[].runId` carries it. `pr blockers` failing checks carry `runId` too.
4. **Age of the failure in `ci logs`.** `run` gains `createdAt` and `headSha` (both with `--run` and by branch). Without `--run`, when the newest completed run of the same workflow is newer than the failed one and did not fail (the run `risks` reads), `run.newerRun` = `{ runId, conclusion, createdAt, headSha }` and `logNote` says the failure was superseded. The failed run's log is still returned. With `--run` there is no `newerRun` (not asked).
5. **`--tail` without splitting the whole log.** A helper walks back from the end of the string with `lastIndexOf('\n')` and keeps only the last `n` lines; `truncated` is whether more lines exist before them. The log still reaches memory once (gh output is buffered by `spawnSync`); streaming it is out of scope.

## Non-goals

No new flags. No change to which runs count as failed. No streaming of `gh run view --log-failed`.
